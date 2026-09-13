import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CatalogClient, CatalogError } from '../src/catalog/index.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/catalog.json', import.meta.url), 'utf8'));
const base = 'https://example.test/repo/catalog/v1/manifest.json';
function make(data = structuredClone(fixture)) {
  const files = new Map<string, string>();
  const manifest: any = { contract_version: '1.0.0', snapshot_id: 'snapshot-1', generated_at: '2026-09-13T00:00:00.000Z', collections: {} };
  for (const [collection, records] of Object.entries(data)) {
    const href = `snapshots/snapshot-1/${collection}.json`;
    const value = JSON.stringify({ contract_version: manifest.contract_version, snapshot_id: manifest.snapshot_id, collection, records });
    files.set(new URL(href, base).href, value);
    manifest.collections[collection] = [{ href, sha256: createHash('sha256').update(value).digest('hex'), bytes: Buffer.byteLength(value), count: (records as any[]).length }];
  }
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    const value = String(input) === base ? JSON.stringify(manifest) : files.get(String(input));
    return value === undefined ? new Response('', { status: 404 }) : new Response(value);
  };
  return { manifest, files, fetcher, data, client: () => new CatalogClient({ manifestUrl: base, fetch: fetcher }) };
}
test('loads complete independent contract, keeps all references and minimal tombstones', async () => {
  const setup = make(); const catalog = await setup.client().load();
  assert.deepEqual(catalog.collections, fixture);
  assert.equal(catalog.get('resource:withdrawn-example')?.kind, 'tombstone');
  assert.ok(Object.isFrozen(catalog.collections.projects[0]));
  const results = await setup.client().search('', { kind: 'resource', limit: 100 });
  assert.ok(results.length > 0); assert.ok(results.every(item => item.kind === 'resource' && item.status === 'listed'));
  assert.equal(await setup.client().get('resource:missing'), undefined);
});
test('unknown optional fields and new resource classifications remain forward compatible', async () => {
  const data = structuredClone(fixture); data.resources[0].resource_type = 'new_resource'; data.resources[0].future_optional = { value: true };
  const catalog = await make(data).client().load(); assert.equal(catalog.collections.resources[0].resource_type, 'new_resource');
});
test('rejects corrupt shard bytes and digest without accepting a partial snapshot', async () => {
  const setup = make(); const url = [...setup.files.keys()][0]!;
  setup.files.set(url, setup.files.get(url)!.replace('source_repository', 'source_repositorx'));
  await assert.rejects(setup.client().load(), (error: any) => error.code === 'digest_mismatch');
});
test('rejects a shard from a different snapshot even when digest is correct', async () => {
  const setup = make(); const descriptor = setup.manifest.collections.sources[0]; const url = new URL(descriptor.href, base).href;
  const changed = setup.files.get(url)!.replace('snapshot-1', 'snapshot-2'); setup.files.set(url, changed);
  descriptor.sha256 = createHash('sha256').update(changed).digest('hex');
  await assert.rejects(setup.client().load(), (error: any) => error.code === 'snapshot_mismatch');
});
test('rejects wrong counts, duplicate URLs and byte budgets before partial acceptance', async () => {
  const setup = make(); setup.manifest.collections.sources[0].count++;
  await assert.rejects(setup.client().load(), (error: any) => error.code === 'count_mismatch');
  const duplicate = make(); duplicate.manifest.collections.actors[0].href = duplicate.manifest.collections.sources[0].href;
  await assert.rejects(duplicate.client().load(), CatalogError);
  await assert.rejects(new CatalogClient({ manifestUrl: base, fetch: make().fetcher, limits: { totalBytes: 20 } }).load(), CatalogError);
});
test('rejects unsafe manifest and shard paths before requesting external URLs', async () => {
  for (const path of ['../x', '%2e%2e/x', '%252e%252e/x', '/x', 'https://evil.test/x', 'x?token=secret', 'x\\y', 'a//b']) {
    const setup = make(); setup.manifest.collections.sources[0].href = path;
    await assert.rejects(setup.client().load(), CatalogError);
  }
  for (const url of ['http://example.test/catalog.json', 'https://example.test/a/../manifest.json', 'https://user:secret@example.test/manifest.json', 'https://example.test/manifest.json?token=x']) assert.throws(() => new CatalogClient({ manifestUrl: url }), CatalogError);
});
test('requires custom formats and cross-object semantic checks', async () => {
  const mutations: ((data: any) => void)[] = [
    data => { data.projects[0].source_refs[0].source_id = 'source:github:999'; },
    data => { data.sources[0].availability = 'private'; },
    data => { data.resources[0].runtime.status = 'automatic_success'; },
    data => { data.resources[0].license = { status: 'identified', spdx_id: 'MIT' }; },
    data => { data.projects[0].updated_at = '2026-02-30T00:00:00Z'; },
    data => { data.projects[0].source_refs[0].path = '../secret'; },
    data => { data.projects[0].provenance.title[0].url = 'https://example.test/?access_token=secret'; },
    data => { data.projects[0].provenance.title = []; },
    data => { data.tombstones[0].description = 'Withdrawn private text'; },
    data => { data.sources[0].aliases = [{ url: 'https://github.com/old/name', verified_at: '2026-09-12T00:00:00Z', provider_id: 999 }]; },
    data => { data.organizations[0].participation = 'actively_curated'; },
    data => { data.relations[0].from_id = data.relations[0].to_id; },
  ];
  for (const mutate of mutations) { const data = structuredClone(fixture); mutate(data); await assert.rejects(make(data).client().load(), CatalogError); }
});
test('expired verified claims are rejected relative to snapshot publication', async () => {
  const data = structuredClone(fixture);
  Object.assign(data.claims[0], { status: 'verified', verified_by: 'actor:github:102', verified_at: '2026-09-12T00:00:00Z', expires_at: '2026-09-12T12:00:00Z', authority: 'repository_maintainer' });
  await assert.rejects(make(data).client().load(), (error: any) => error.code === 'expired_claim');
});
test('request timeout includes a stalled response body', async () => {
  const fetcher: typeof fetch = async () => new Response(new ReadableStream({ start() {} }));
  await assert.rejects(new CatalogClient({ manifestUrl: base, fetch: fetcher, limits: { timeoutMs: 20 } }).load(), (error: any) => error.code === 'timeout');
});
test('redirects and malformed UTF-8 cannot replace a manifest', async () => {
  await assert.rejects(new CatalogClient({ manifestUrl: base, fetch: async () => new Response('', { status: 302, headers: { location: 'https://other.test/' } }) }).load(), CatalogError);
  await assert.rejects(new CatalogClient({ manifestUrl: base, fetch: async () => new Response(new Uint8Array([0xff, 0xfe])) }).load(), (error: any) => error.code === 'invalid_json');
});
