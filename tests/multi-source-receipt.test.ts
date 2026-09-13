import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBridge } from '../src/bridge.js';
import type { CatalogSnapshot } from '../src/catalog/index.js';
import { createCatalogReviewGuard } from '../src/catalog/review-validation.js';
import type { Host, Submission } from '../src/contracts.js';
import { ConnectorCore } from '../src/core.js';
import { Inbox, type InboxEntry } from '../src/inbox.js';

test('v9-r2 multi-source review survives HTTP receipt, owner readback and core/store restart exactly', async () => {
  // Frozen output from the actual Network serializer, independent of the Connector guard builder.
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/review-v9-r2.json', import.meta.url), 'utf8'));
  const reviewed = fixture.resourceReview;
  assert.deepEqual(reviewed.sources.map((source: any) => source.id), ['source:github:201', 'source:github:202']);
  assert.equal(reviewed.conditions.length, 2);
  const catalog: CatalogSnapshot = {
    manifest: { contract_version: '1.0.0', snapshot_id: fixture.data.snapshot_id,
      generated_at: fixture.data.generated_at, collections: {} as any },
    collections: fixture.data.catalog, loadedAt: '2026-09-13T00:00:00.000Z',
    get: id => (Object.values(fixture.data.catalog).flat() as any[]).find(item => item.id === id),
  };
  let catalogLoads = 0, projectWrites = 0;
  const guard = createCatalogReviewGuard({ load: async () => { catalogLoads++; return catalog; } });
  const host: Host = {
    status: async () => ({ ready: true, instanceId: 'synthetic-process-1', hostId: 'synthetic-workspace-1' }),
    listProjects: async () => [],
    createProject: async () => { projectWrites++; throw new Error('Receipt must not create a project.'); },
  };
  const origin = 'https://aipoch.network', ownerToken = 'multi-source-test-owner';
  const dir = mkdtempSync(join(tmpdir(), 'aipoch-multi-source-'));
  const path = join(dir, 'inbox.sqlite');
  async function start() {
    const inbox = new Inbox(path);
    const core = new ConnectorCore(inbox, host, () => Date.now(), guard);
    const server = createBridge(core, { adminToken: ownerToken, origins: [origin] });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return { inbox, core, server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }
  async function stop(runtime: Awaited<ReturnType<typeof start>>) {
    await new Promise<void>((resolve, reject) => runtime.server.close(error => error ? reject(error) : resolve()));
    runtime.inbox.close();
  }
  let runtime = await start();
  const call = (route: string, token: string, data?: unknown, browser = true) => fetch(runtime.url + route, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(browser ? { Origin: origin } : {}),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  async function json(response: Response) {
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  try {
    const pairing = await json(await call('/v1/pairings', '', { protocolVersion: '1.0', attemptId: 'multi-source' }));
    await json(await call(`/admin/pairings/${pairing.pairingId}/approve`, ownerToken,
      { code: pairing.verificationCode, origin }, false));
    const { session } = await json(await call(`/v1/pairings/${pairing.pairingId}`, pairing.pollToken));
    // Preserve formatting too: the extra final newline must not disappear during transport/storage.
    const content = JSON.stringify(reviewed, null, 2) + '\n';
    const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
    const input: Submission = {
      protocolVersion: '1.0', requestId: 'reference-multi-source', sessionId: session.id,
      objectId: reviewed.object.id, action: 'receive_reference',
      review: { format: 'aipoch-network-internal-review-1', content, sha256 },
    };
    const receipt = await json(await call('/v1/references', session.token, input));
    assert.equal(receipt.outcome, 'received');
    assert.equal(receipt.contentSha256, sha256);
    assert.deepEqual(await json(await call(`/v1/receipts/${input.requestId}`, session.token)), receipt);
    assert.deepEqual(await json(await call('/v1/references', session.token, input)), receipt);
    assert.equal(catalogLoads, 1, 'The first delivery validates the complete catalog; replay reuses durable evidence.');

    const assertExactEntry = (entry: InboxEntry) => {
      assert.deepEqual(entry.receipt, receipt);
      assert.deepEqual(entry.submission, input);
      assert.equal(entry.hostInstanceId, 'synthetic-process-1');
      assert.equal(entry.submission.review.content, content);
      assert.equal(createHash('sha256').update(entry.submission.review.content, 'utf8').digest('hex'), sha256);
      const savedReview = JSON.parse(entry.submission.review.content);
      assert.deepEqual(savedReview, reviewed);
      assert.deepEqual(savedReview.sources.map((source: any) => source.id), ['source:github:201', 'source:github:202']);
      // Full equality retains the fixed source's commit/path/license and the second source's explicit unknowns.
      assert.deepEqual(savedReview.sources, reviewed.sources);
      assert.deepEqual(savedReview.license, reviewed.license);
      assert.deepEqual(savedReview.conditions, reviewed.conditions);
    };
    assertExactEntry(await json(await call(`/admin/inbox/${input.requestId}`, ownerToken, undefined, false)));
    await stop(runtime);
    runtime = await start();
    assertExactEntry(await json(await call(`/admin/inbox/${input.requestId}`, ownerToken, undefined, false)));
    assertExactEntry(runtime.inbox.get(input.requestId)!);
    assert.equal((await json(await call('/admin/inbox', ownerToken, undefined, false))).length, 1);
    assert.equal((await call(`/v1/receipts/${input.requestId}`, session.token)).status, 401,
      'Durable reviewed contents survive restart; browser authority does not.');
    assert.equal(catalogLoads, 1, 'Readback must not reconstruct saved content from a new catalog projection.');
    assert.equal(projectWrites, 0);
  } finally {
    await stop(runtime);
    rmSync(dir, { recursive: true, force: true });
  }
});
