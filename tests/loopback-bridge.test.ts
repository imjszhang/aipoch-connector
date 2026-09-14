import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBridge } from '../src/bridge.js';
import type { CatalogSnapshot } from '../src/catalog/index.js';
import { createCatalogReviewGuard } from '../src/catalog/review-validation.js';
import { digest, type Host, type Submission } from '../src/contracts.js';
import { ConnectorCore } from '../src/core.js';
import { Inbox } from '../src/inbox.js';

const production = 'https://aipoch.network';
const ownerToken = 'synthetic-loopback-owner';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/review-v9-r2.json', import.meta.url), 'utf8'));
const catalog: CatalogSnapshot = {
  manifest: { contract_version: '1.0.0', snapshot_id: fixture.data.snapshot_id,
    generated_at: fixture.data.generated_at, collections: {} as any },
  collections: fixture.data.catalog, loadedAt: '2026-09-13T00:00:00.000Z',
  get: id => (Object.values(fixture.data.catalog).flat() as any[]).find(item => item.id === id),
};

async function start(options: { allowLoopbackHttp?: boolean; origins?: string[]; path?: string } = {}) {
  let projectWrites = 0;
  const host: Host = {
    status: async () => ({ ready: true, instanceId: 'synthetic-process', hostId: 'synthetic-workspace' }),
    listProjects: async () => [],
    createProject: async () => { projectWrites++; throw new Error('Receiving references must not write to the host.'); },
  };
  const inbox = new Inbox(options.path ?? ':memory:');
  const core = new ConnectorCore(inbox, host, () => Date.now(), createCatalogReviewGuard({ load: async () => catalog }));
  const server = createBridge(core, { adminToken: ownerToken, origins: options.origins ?? [production],
    ...(options.allowLoopbackHttp === undefined ? {} : { allowLoopbackHttp: options.allowLoopbackHttp }) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, origin?: string, method = 'GET', data?: unknown, token?: string) => fetch(url + path, {
    method, headers: { ...(origin === undefined ? {} : { Origin: origin }),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const stop = async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    inbox.close();
  };
  return { core, inbox, call, stop, projectWrites: () => projectWrites };
}
async function json(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function connect(runtime: Awaited<ReturnType<typeof start>>, origin: string, attemptId: string) {
  const pairing = await json(await runtime.call('/v1/pairings', origin, 'POST', { protocolVersion: '1.0', attemptId }));
  await json(await runtime.call(`/admin/pairings/${pairing.pairingId}/approve`, undefined, 'POST',
    { code: pairing.verificationCode, origin }, ownerToken));
  return (await json(await runtime.call(`/v1/pairings/${pairing.pairingId}`, origin, 'GET', undefined, pairing.pollToken))).session;
}
function submission(sessionId: string, requestId: string, review = structuredClone(fixture.resourceReview)): Submission {
  const content = JSON.stringify(review, null, 2) + '\n';
  return { protocolVersion: '1.0', requestId, sessionId, objectId: review.object.id, action: 'receive_reference',
    review: { format: 'aipoch-network-internal-review-1', content, sha256: digest(content) } };
}

test('loopback HTTP preflight and requests share strict admission and exact CORS', async () => {
  const runtime = await start({ allowLoopbackHttp: true });
  const port = randomInt(1024, 65000);
  const allowed = [production, 'http://localhost', 'http://127.0.0.1', 'http://[::1]',
    `http://localhost:${port}`, `http://localhost:${port + 1}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`, 'http://localhost:65535'];
  const denied = [undefined, 'null', 'https://localhost:3000', 'http://localhost.evil.example:3000',
    'http://evil.localhost:3000', 'http://localhost.:3000', 'http://127.0.0.2:3000', 'http://0.0.0.0:3000',
    'http://192.168.1.10:3000', 'http://[::ffff:127.0.0.1]:3000', 'http://2130706433:3000',
    'http://0x7f000001:3000', 'http://127.1:3000', 'http://LOCALHOST:3000', 'http://localhost:80',
    'http://localhost:03000', 'http://localhost:3000/', 'http://localhost:3000/path', 'http://localhost:3000?q=1',
    'http://localhost:3000#fragment', 'http://user@localhost:3000', 'http://localhost:3000 http://127.0.0.1:3000',
    'https://www.aipoch.network', 'http://example.test:3000', 'https://example.test'];
  try {
    for (const [index, origin] of allowed.entries()) {
      const preflight = await runtime.call('/v1/pairings', origin, 'OPTIONS');
      assert.equal(preflight.status, 204, origin);
      assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
      assert.equal(preflight.headers.get('vary'), 'Origin');
      const response = await runtime.call('/v1/pairings', origin, 'POST', { protocolVersion: '1.0', attemptId: `allowed-${index}` });
      assert.equal(response.status, 200, origin);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('vary'), 'Origin');
    }
    for (const origin of denied) for (const method of ['OPTIONS', 'POST']) {
      const response = await runtime.call('/v1/pairings', origin, method,
        method === 'POST' ? { protocolVersion: '1.0', attemptId: 'denied' } : undefined);
      assert.equal(response.status, 403, `${method} ${origin}`);
      assert.equal((await response.json()).error.code, 'origin_denied');
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
  } finally { await runtime.stop(); }
});

test('admitted loopback websites still require owner approval and cannot share pairing or session authority', async () => {
  const runtime = await start({ allowLoopbackHttp: true });
  const port = randomInt(1024, 65000), origin = `http://localhost:${port}`;
  const others = [`http://localhost:${port + 1}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`];
  try {
    const pairing = await json(await runtime.call('/v1/pairings', origin, 'POST', { protocolVersion: '1.0', attemptId: 'isolation' }));
    assert.deepEqual(await json(await runtime.call(`/v1/pairings/${pairing.pairingId}`, origin, 'GET', undefined, pairing.pollToken)), { status: 'pending' });
    for (const token of [undefined, 'invalid-token']) {
      assert.equal((await runtime.call(`/v1/pairings/${pairing.pairingId}`, origin, 'GET', undefined, token)).status, 401);
      assert.equal((await runtime.call('/v1/session', origin, 'GET', undefined, token)).status, 401);
    }
    for (const website of [origin, ...others]) {
      assert.equal((await runtime.call(`/admin/pairings/${pairing.pairingId}/approve`, website, 'POST',
        { code: pairing.verificationCode, origin }, ownerToken)).status, 401);
      assert.equal((await runtime.call('/admin/projects', website, 'GET', undefined, ownerToken)).status, 401);
    }
    for (const other of others) {
      assert.equal((await runtime.call(`/v1/pairings/${pairing.pairingId}`, other, 'GET', undefined, pairing.pollToken)).status, 401);
      assert.equal((await runtime.call(`/admin/pairings/${pairing.pairingId}/approve`, undefined, 'POST',
        { code: pairing.verificationCode, origin: other }, ownerToken)).status, 409);
    }
    await json(await runtime.call(`/admin/pairings/${pairing.pairingId}/approve`, undefined, 'POST',
      { code: pairing.verificationCode, origin }, ownerToken));
    const { session } = await json(await runtime.call(`/v1/pairings/${pairing.pairingId}`, origin, 'GET', undefined, pairing.pollToken));
    await json(await runtime.call('/v1/session', origin, 'GET', undefined, session.token));
    for (const other of others) {
      assert.equal((await runtime.call('/v1/session', other, 'GET', undefined, session.token)).status, 401);
      assert.equal((await runtime.call('/v1/references', other, 'POST', submission(session.id, 'cross-origin'), session.token)).status, 401);
      // Disconnect keeps its existing idempotent response, but cannot revoke another origin's session.
      assert.deepEqual(await json(await runtime.call('/v1/session', other, 'DELETE', undefined, session.token)), { disconnected: true });
      assert.equal((await runtime.call('/v1/session', origin, 'GET', undefined, session.token)).status, 200);
    }
    assert.equal(runtime.inbox.list().length, 0);
    assert.equal(runtime.projectWrites(), 0);
  } finally { await runtime.stop(); }
});

test('loopback canonical references remain exact and durable while route, snapshot, sources and licenses cannot change', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aipoch-loopback-receipt-')), path = join(dir, 'inbox.sqlite');
  const port = randomInt(1024, 65000), origin = `http://localhost:${port}`, other = `http://localhost:${port + 1}`;
  let runtime = await start({ allowLoopbackHttp: true, path });
  try {
    const session = await connect(runtime, origin, 'canonical-receipt');
    const otherSession = await connect(runtime, other, 'other-origin');
    const input = submission(session.id, 'canonical-loopback-reference');
    assert.ok(JSON.parse(input.review.content).public_location.startsWith(production + '/'));
    const receipt = await json(await runtime.call('/v1/references', origin, 'POST', input, session.token));
    assert.equal(receipt.outcome, 'received');
    assert.equal(receipt.contentSha256, input.review.sha256);
    assert.deepEqual(await json(await runtime.call(`/v1/receipts/${input.requestId}`, origin, 'GET', undefined, session.token)), receipt);
    assert.equal((await runtime.call(`/v1/receipts/${input.requestId}`, other, 'GET', undefined, session.token)).status, 401);
    assert.equal((await runtime.call(`/v1/receipts/${input.requestId}`, other, 'GET', undefined, otherSession.token)).status, 404);
    const mutations: Array<[(review: any) => void, string]> = [
      [review => { review.public_location = review.public_location.replace(production, origin); }, 'invalid_review'],
      [review => { review.public_location = review.public_location.replace(production, 'https://example.test'); }, 'reference_changed'],
      [review => { review.snapshot.id = 'other-snapshot'; }, 'catalog_changed'],
      [review => { review.sources[0].commit = 'b'.repeat(40); }, 'reference_changed'],
      [review => { review.sources.pop(); }, 'reference_changed'],
      [review => { review.sources[0].license.conditions = 'Changed permission'; }, 'reference_changed'],
      [review => { review.license.conditions = 'Changed permission'; }, 'reference_changed'],
      [review => { review.conditions = []; }, 'reference_changed'],
    ];
    for (const [index, [mutate, code]] of mutations.entries()) {
      const review = structuredClone(fixture.resourceReview); mutate(review);
      const response = await runtime.call('/v1/references', origin, 'POST', submission(session.id, `tampered-${index}`, review), session.token);
      assert.equal((await response.json()).error.code, code);
    }
    assert.equal(runtime.inbox.list().length, 1);
    const saved = await json(await runtime.call(`/admin/inbox/${input.requestId}`, undefined, 'GET', undefined, ownerToken));
    assert.deepEqual(saved.submission, input);
    assert.deepEqual(saved.receipt, receipt);
    assert.equal(runtime.projectWrites(), 0);
    await runtime.stop();
    runtime = await start({ allowLoopbackHttp: false, path });
    assert.deepEqual(await json(await runtime.call(`/admin/inbox/${input.requestId}`, undefined, 'GET', undefined, ownerToken)), saved);
    assert.equal((await runtime.call('/v1/session', origin, 'GET', undefined, session.token)).status, 403);
    assert.equal((await runtime.call('/v1/pairings', production, 'OPTIONS')).status, 204);
    assert.equal(runtime.projectWrites(), 0);
  } finally { await runtime.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('disabled or omitted bridge policy preserves exact configured production and local origins', async () => {
  const port = randomInt(1024, 65000), explicit = `http://localhost:${port}`, implicit = `http://localhost:${port + 1}`;
  for (const allowLoopbackHttp of [undefined, false]) {
    const runtime = await start({ allowLoopbackHttp, origins: [production, explicit, 'https://localhost:3000'] });
    try {
      for (const origin of [production, explicit, 'https://localhost:3000']) {
        assert.equal((await runtime.call('/v1/pairings', origin, 'OPTIONS')).status, 204);
        const pairing = await json(await runtime.call('/v1/pairings', origin, 'POST', { protocolVersion: '1.0', attemptId: 'explicit' }));
        assert.equal((await json(await runtime.call(`/v1/pairings/${pairing.pairingId}`, origin, 'GET', undefined, pairing.pollToken))).status, 'pending');
      }
      for (const method of ['OPTIONS', 'POST']) {
        const response = await runtime.call('/v1/pairings', implicit, method,
          method === 'POST' ? { protocolVersion: '1.0', attemptId: 'implicit-denied' } : undefined);
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error.code, 'origin_denied');
      }
    } finally { await runtime.stop(); }
  }
});
