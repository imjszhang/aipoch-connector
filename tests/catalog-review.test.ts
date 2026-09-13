import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCatalogReviewGuard, expectedCatalogReview, validateReviewAgainstCatalog } from '../src/catalog/review-validation.js';
import { digest, parseSubmission } from '../src/contracts.js';
import type { CatalogSnapshot } from '../src/catalog/index.js';

// Frozen artifact generated with the actual Network v9-r2 serializer, not this guard's builder.
const fixture = JSON.parse(await readFile(new URL('./fixtures/review-v9-r2.json', import.meta.url), 'utf8'));
function snapshot(data = structuredClone(fixture.data)): CatalogSnapshot {
  return {
    manifest: { contract_version: '1.0.0', snapshot_id: data.snapshot_id, generated_at: data.generated_at, collections: {} as any },
    collections: data.catalog, loadedAt: '2026-09-13T00:00:00.000Z',
    get: id => (Object.values(data.catalog).flat() as any[]).find(item => item.id === id),
  };
}
function envelope(review = structuredClone(fixture.resourceReview)) {
  const content = JSON.stringify(review, null, 2);
  return { protocolVersion: '1.0' as const, requestId: 'reference-golden', sessionId: 'session-golden', objectId: review.object.id, action: 'receive_reference' as const, review: { format: 'aipoch-network-internal-review-1' as const, content, sha256: digest(content) } };
}
function changed(mutate: (review: any) => void) { const review = structuredClone(fixture.resourceReview); mutate(review); return envelope(review); }
test('accepts genuine v9-r2 project and resource reviews with every original source', () => {
  const current = snapshot();
  for (const review of [fixture.projectReview, fixture.resourceReview]) {
    assert.deepEqual(expectedCatalogReview(current, review.object.id), review);
    assert.deepEqual(validateReviewAgainstCatalog(envelope(review), current), review);
  }
  assert.equal(fixture.resourceReview.sources.length, 2);
  assert.equal(fixture.resourceReview.conditions.length, 2);
});
test('rejects empty, missing, duplicated, reordered or replaced source sets', () => {
  const mutations: ((review: any) => void)[] = [
    review => { review.sources = []; },
    review => { review.sources.pop(); },
    review => { review.sources.push(structuredClone(review.sources[0])); },
    review => { review.sources.reverse(); },
    review => { review.sources[1] = structuredClone(review.sources[0]); },
    review => { review.sources[0].id = 'source:github:999'; },
  ];
  for (const mutate of mutations) assert.throws(() => validateReviewAgainstCatalog(changed(mutate), snapshot()), { name: 'Error' });
});
test('rejects independently valid tampering with every reviewed source field', () => {
  const alternatives: Record<string, unknown> = {
    id: 'source:github:202', role: 'documentation', url: 'https://github.com/other/repository',
    reference_url: 'https://github.com/example-lab/research/blob/main/changed.yaml',
    commit: 'b'.repeat(40), named_reference: 'other-branch', path: 'other/file.yaml',
    sha256: 'c'.repeat(64), resolved_at: '2026-09-12T01:00:00.000Z', availability: 'unknown',
    archived: true, stale: true, observed_at: '2026-09-12T01:00:00.000Z',
  };
  for (const [field, value] of Object.entries(alternatives)) {
    const input = changed(review => { review.sources[0][field] = value; });
    parseSubmission(input); // These are legal-looking values; schema validation alone is insufficient.
    assert.throws(() => validateReviewAgainstCatalog(input, snapshot()), (error: any) => error.code === 'reference_changed', field);
  }
  assert.throws(() => validateReviewAgainstCatalog(changed(review => { review.sources[0].version_status = 'unfixed'; }), snapshot()));
  assert.throws(() => validateReviewAgainstCatalog(changed(review => { review.sources[0].path_status = 'not_supplied'; }), snapshot()));
});
test('rejects source and resource license changes, added rights and changed conditions', () => {
  for (const location of ['source', 'resource']) for (const field of ['name', 'spdx_id', 'url', 'path', 'commit', 'conditions']) {
    const input = changed(review => {
      const license = location === 'source' ? review.sources[0].license : review.license;
      license[field] = field === 'url' ? 'https://example.test/license' : field === 'commit' ? 'e'.repeat(40) : 'changed';
    });
    parseSubmission(input);
    assert.throws(() => validateReviewAgainstCatalog(input, snapshot()), (error: any) => error.code === 'reference_changed');
  }
  for (const mutate of [
    (review: any) => { review.license = { status: 'unknown' }; },
    (review: any) => { review.sources[0].license = { status: 'unknown' }; },
    (review: any) => { review.conditions = []; },
    (review: any) => { review.conditions.push('May execute automatically'); },
    (review: any) => { review.sources[0].license.additional_rights = 'unrestricted'; },
  ]) assert.throws(() => validateReviewAgainstCatalog(changed(mutate), snapshot()), (error: any) => error.code === 'reference_changed');
});
test('rejects changed object/public route/snapshot and unlisted or withdrawn records', () => {
  for (const mutate of [
    (review: any) => { review.object.title = 'Different research'; },
    (review: any) => { review.public_location = 'https://evil.example/capabilities/resource~analysis-001/'; },
  ]) assert.throws(() => validateReviewAgainstCatalog(changed(mutate), snapshot()), (error: any) => error.code === 'reference_changed');
  for (const mutate of [
    (review: any) => { review.snapshot.id = 'different-snapshot'; },
    (review: any) => { review.snapshot.generated_at = '2026-09-13T01:00:00.000Z'; },
  ]) assert.throws(() => validateReviewAgainstCatalog(changed(mutate), snapshot()), (error: any) => error.code === 'catalog_changed');
  const candidate = structuredClone(fixture.data); candidate.catalog.resources[1].status = 'candidate';
  assert.throws(() => validateReviewAgainstCatalog(envelope(), snapshot(candidate)), (error: any) => error.code === 'reference_unavailable');
  const candidateSource = structuredClone(fixture.data); candidateSource.catalog.sources[0].status = 'candidate';
  assert.throws(() => validateReviewAgainstCatalog(envelope(), snapshot(candidateSource)), (error: any) => error.code === 'source_unavailable');
  for (const availability of ['private', 'deleted']) {
    const data = structuredClone(fixture.data); data.catalog.sources[0].availability = availability;
    assert.throws(() => validateReviewAgainstCatalog(envelope(), snapshot(data)), (error: any) => error.code === 'source_unavailable');
  }
  const withdrawn = structuredClone(fixture.data); withdrawn.catalog.tombstones.push({ kind: 'tombstone', id: 'source:github:201', status: 'withdrawn', withdrawn_at: '2026-09-13T00:00:00.000Z' });
  assert.throws(() => validateReviewAgainstCatalog(envelope(), snapshot(withdrawn)), (error: any) => error.code === 'source_unavailable');
});
test('retains meaningful license extensions only when they match the trusted catalog', () => {
  const data = structuredClone(fixture.data); data.catalog.sources[0].license.additional_notice = { attribution: ['Synthetic author'], format: 'future-optional-v1' };
  const review = structuredClone(fixture.resourceReview); review.sources[0].license.additional_notice = data.catalog.sources[0].license.additional_notice;
  assert.deepEqual(validateReviewAgainstCatalog(envelope(review), snapshot(data)), review);
  assert.throws(() => validateReviewAgainstCatalog(envelope(review), snapshot()), (error: any) => error.code === 'reference_changed');
});
test('JSON whitespace/object key order may vary while exact original bytes remain bound to digest', () => {
  const reversed = (value: any): any => Array.isArray(value) ? value.map(reversed) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversed(child)])) : value;
  const input = envelope(reversed(fixture.resourceReview));
  input.review.content = JSON.stringify(JSON.parse(input.review.content)); input.review.sha256 = digest(input.review.content);
  validateReviewAgainstCatalog(input, snapshot());
  assert.equal(parseSubmission(input).review.content, input.review.content);
  input.review.content += ' ';
  assert.throws(() => validateReviewAgainstCatalog(input, snapshot()), (error: any) => error.code === 'content_mismatch');
});
test('strict pinned review format rejects unknown top-level/source fields and incomplete typed facts', () => {
  const mutations: ((review: any) => void)[] = [
    review => { review.automatic_execute = true; }, review => { review.sources[0].automatic_execute = true; },
    review => { delete review.sources[0].license; }, review => { delete review.public_location; },
    review => { delete review.snapshot.generated_at; }, review => { review.sources[0].archived = null; },
    review => { review.sources[0].observed_at = '2026-02-30T00:00:00Z'; },
    review => { review.sources[0].path = '../secret'; }, review => { review.sources[0].url = 'https://example.test/?token=secret'; },
    review => { review.sources[0].commit = 123; }, review => { review.license = { status: 'identified', spdx_id: 'MIT' }; },
  ];
  for (const mutate of mutations) assert.throws(() => parseSubmission(changed(mutate)), (error: any) => error.code === 'invalid_review');
});
test('runtime guard loads one fresh complete snapshot and refuses stale reviews', async () => {
  let loads = 0; let current = snapshot();
  const guard = createCatalogReviewGuard({ load: async () => { loads++; return current; } });
  await guard(envelope()); assert.equal(loads, 1);
  current = { ...current, manifest: { ...current.manifest, snapshot_id: 'new-snapshot' } };
  await assert.rejects(guard(envelope()), (error: any) => error.code === 'catalog_changed'); assert.equal(loads, 2);
});
test('duplicate JSON keys cannot smuggle different sources or conditions inside approved bytes', () => {
  for (const replace of [
    (content: string) => content.replace('"id": "source:github:201"', '"id": "source:github:999", "id": "source:github:201"'),
    (content: string) => content.replace('"id": "source:github:201"', '"\\u0069d": "source:github:999", "id": "source:github:201"'),
    (content: string) => content.replace('"conditions": [', '"conditions": ["unreviewed permission"], "conditions": ['),
  ]) {
    const input = envelope(); input.review.content = replace(input.review.content); input.review.sha256 = digest(input.review.content);
    assert.deepEqual(JSON.parse(input.review.content), fixture.resourceReview);
    assert.throws(() => validateReviewAgainstCatalog(input, snapshot()), (error: any) => error.code === 'invalid_review');
  }
});
