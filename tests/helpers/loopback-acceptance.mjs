import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

/** Real Connector processes and public SDK HTTP fixture; no installed host or browser is used. */
export async function verifyLoopback(root, source = false) {
  const dir = await mkdtemp(join(tmpdir(), 'aipoch-loopback-'));
  const load = path => import(pathToFileURL(join(root, source ? 'src' : 'dist', path + (source ? '.ts' : '.js'))).href);
  const { configuration, configurationDigest, saveConfiguration, runtimeRecord, adminRequest } = await load('runtime');
  const { Inbox } = await load('inbox');
  const fixture = JSON.parse(await readFile(new URL('../fixtures/review-v9-r2.json', import.meta.url), 'utf8'));
  const command = source ? ['--import', 'tsx', join(root, 'src/cli.ts')] : [join(root, 'dist/cli.js')];
  const env = { ...process.env }; delete env.AIPOCH_GITHUB_TOKEN;
  const run = (...args) => execute(process.execPath, [...command, ...args, '--data-dir', dir], { cwd: root, env, timeout: 30_000 });
  const cli = async (...args) => JSON.parse((await run(...args)).stdout);
  const hostRoot = join(dir, 'synthetic-public-host');
  const hostToken = randomBytes(32).toString('hex');
  const connectors = [];
  const hostRequests = [];
  const files = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (files.has(request.url)) {
      assert.ok(request.headers.authorization === undefined, 'Catalog requests must not carry host credentials');
      response.end(files.get(request.url)); return;
    }
    if (request.headers.authorization !== `Bearer ${hostToken}`) { response.writeHead(401).end('{}'); return; }
    let bytes = ''; for await (const chunk of request) bytes += chunk;
    hostRequests.push({ method: request.method, path: request.url });
    if (request.url === '/api/bootstrap') { response.end(JSON.stringify({ appVersion: '0.28.0-fixture' })); return; }
    if (request.url === '/api/v1/connectors') {
      if (request.method === 'POST') connectors.push({ ...JSON.parse(bytes), enabled: false });
      response.end(JSON.stringify({ data: { customServers: connectors, connectors: [] } })); return;
    }
    if (request.url === '/api/v1/connectors/aipoch-connector/enabled' && request.method === 'PUT') {
      connectors[0].enabled = JSON.parse(bytes).enabled; response.end(JSON.stringify({ data: {} })); return;
    }
    if (request.url === '/api/v1/projects' && request.method === 'GET') {
      response.end(JSON.stringify({ data: [{ id: 'fixture-project', name: 'Synthetic existing project' }] })); return;
    }
    response.writeHead(404).end('{}');
  });
  let runtimeStarted = false;
  try {
    const config = await configuration(dir);
    assert.equal(config.allowLoopbackHttp, true, 'A fresh installation must default to local HTTP access');
    assert.deepEqual(config.origins, ['https://aipoch.network']);
    await assert.rejects(access(join(dir, 'config.json')), { code: 'ENOENT' });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const hostPort = server.address().port;
    await mkdir(hostRoot, { mode: 0o700 });
    // Generated test profile for the public SDK, never a user's host configuration.
    await writeFile(join(hostRoot, 'web-token'), hostToken, { mode: 0o600 });
    await writeFile(join(hostRoot, 'web-service.json'), JSON.stringify({
      pid: process.pid, port: hostPort, startedAt: '2026-09-14T00:00:00.000Z', appVersion: '0.28.0-fixture',
    }), { mode: 0o600 });
    const manifest = { contract_version: '1.0.0', snapshot_id: fixture.data.snapshot_id,
      generated_at: fixture.data.generated_at, collections: {} };
    for (const [collection, records] of Object.entries(fixture.data.catalog)) {
      const href = `snapshots/${manifest.snapshot_id}/${collection}.json`;
      const bytes = JSON.stringify({ contract_version: '1.0.0', snapshot_id: manifest.snapshot_id, collection, records });
      files.set('/catalog/v1/' + href, bytes);
      manifest.collections[collection] = [{ href, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes), count: records.length }];
    }
    files.set('/catalog/v1/manifest.json', JSON.stringify(manifest));
    config.port = await unusedPort(); config.openScienceConfigRoot = hostRoot;
    config.catalogManifestUrl = `http://127.0.0.1:${hostPort}/catalog/v1/manifest.json`;
    await saveConfiguration(dir, config);
    const seeded = new Inbox(join(dir, 'inbox.sqlite'));
    seeded.beginOperation('loopback-pending', sha256('synthetic pending operation'));
    seeded.beginOperation('loopback-complete', sha256('synthetic completed operation'));
    seeded.finishOperation('loopback-complete', { synthetic: true }); seeded.close();
    const help = await run('help'); assert.match(help.stdout, /--loopback-http allow\|deny/);
    const first = await cli('setup'); runtimeStarted = true;
    assert.equal(first.action, 'started'); assert.equal(first.registration.enabled, true);
    assert.equal((await configuration(dir)).allowLoopbackHttp, true);
    let record = await runtimeRecord(dir);
    const call = (path, { origin, method = 'GET', token, body } = {}) => fetch(record.url + path, {
      method, headers: { ...(origin === undefined ? {} : { Origin: origin }), ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5_000),
    });
    const preflight = origin => fetch(record.url + '/v1/pairings', { method: 'OPTIONS', headers: {
      ...(origin === undefined ? {} : { Origin: origin }), 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    }, signal: AbortSignal.timeout(5_000) });
    const allowed = async origin => {
      const response = await preflight(origin);
      assert.equal(response.status, 204, `Expected exact origin allowed: ${origin}`);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('vary'), 'Origin');
    };
    const denied = async origin => {
      for (const response of [await preflight(origin), await call('/v1/pairings', { origin, method: 'POST', body: { protocolVersion: '1.0', attemptId: 'denied' } })]) {
        assert.equal(response.status, 403, `Expected origin denied: ${origin}`);
        assert.equal(response.headers.get('access-control-allow-origin'), null);
        assert.equal((await response.json()).error.code, 'origin_denied');
      }
    };
    const originPort = await unusedPort(); let otherPort = await unusedPort();
    while (otherPort === originPort) otherPort = await unusedPort();
    const origins = ['localhost', '127.0.0.1', '[::1]'].flatMap(host => [`http://${host}:${originPort}`, `http://${host}:${otherPort}`, `http://${host}`]);
    const pairs = [];
    for (const origin of [...origins, 'https://aipoch.network']) {
      await allowed(origin);
      const response = await call('/v1/pairings', { origin, method: 'POST', body: { protocolVersion: '1.0', attemptId: `attempt-${pairs.length}` } });
      assert.equal(response.status, 200); const pair = await response.json(); pairs.push({ origin, ...pair });
      assert.equal((await (await call(`/v1/pairings/${pair.pairingId}`, { origin, token: pair.pollToken })).json()).status, 'pending');
    }
    for (const origin of [undefined, 'null', 'https://localhost:3000', 'http://localhost.evil.example:3000',
      'http://evil.localhost:3000', 'http://localhost.:3000', 'http://127.0.0.2:3000', 'http://0.0.0.0:3000',
      'http://192.168.1.2:3000', 'http://[::ffff:7f00:1]:3000', 'http://2130706433:3000',
      'http://0x7f000001:3000', 'http://127.1:3000', 'http://localhost:80', 'http://LOCALHOST:3000',
      'http://localhost:3000/', 'http://localhost:3000?x=1', 'http://localhost:3000#x',
      'http://user@localhost:3000', 'http://localhost:3000 http://127.0.0.1:3000', 'https://www.aipoch.network']) await denied(origin);
    const pair = pairs[0];
    for (const origin of [origins[1], origins[3]]) {
      assert.equal((await call(`/v1/pairings/${pair.pairingId}`, { origin, token: pair.pollToken })).status, 401);
    }
    assert.equal((await call(`/admin/pairings/${pair.pairingId}/approve`, { origin: pair.origin, token: record.token,
      method: 'POST', body: { code: pair.verificationCode, origin: pair.origin } })).status, 401);
    await adminRequest(dir, `/admin/pairings/${pair.pairingId}/approve`, 'POST', { code: pair.verificationCode, origin: pair.origin });
    const { session } = await (await call(`/v1/pairings/${pair.pairingId}`, { origin: pair.origin, token: pair.pollToken })).json();
    assert.equal((await call('/v1/session', { origin: pair.origin, token: session.token })).status, 200);
    for (const origin of [origins[1], origins[3]]) assert.equal((await call('/v1/session', { origin, token: session.token })).status, 401);
    for (const token of [undefined, 'invalid-session']) assert.equal((await call('/v1/session', { origin: pair.origin, token })).status, 401);
    const content = JSON.stringify(fixture.resourceReview, null, 2);
    const submission = { protocolVersion: '1.0', requestId: 'loopback-reference', sessionId: session.id,
      objectId: fixture.resourceReview.object.id, action: 'receive_reference',
      review: { format: 'aipoch-network-internal-review-1', content, sha256: sha256(content) } };
    const receivedResponse = await call('/v1/references', { origin: pair.origin, token: session.token, method: 'POST', body: submission });
    assert.equal(receivedResponse.status, 200); const receipt = await receivedResponse.json();
    assert.equal(receipt.outcome, 'received'); assert.equal(receipt.contentSha256, sha256(content));
    const durable = await cli('inbox', 'show', submission.requestId);
    assert.deepEqual(durable.receipt, receipt); assert.equal(durable.submission.review.content, content);
    const status = await cli('status');
    const link = await adminRequest(dir, '/admin/associations', 'POST', {
      requestId: submission.requestId, projectId: 'fixture-project', expectedHostId: status.host.hostId,
    });
    const history = await cli('operations', 'list');
    const beforeInvalid = await readFile(join(dir, 'config.json'), 'utf8');
    await assert.rejects(run('setup', '--loopback-http', 'maybe'), error => /loopback-http/.test(error.stderr));
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), beforeInvalid);
    assert.equal((await runtimeRecord(dir)).identity.runtimeId, first.runtime.runtimeId);
    const closed = await cli('setup', '--loopback-http', 'deny');
    assert.equal(closed.action, 'restarted'); assert.notEqual(closed.runtime.runtimeId, first.runtime.runtimeId);
    assert.notEqual(closed.runtime.configSha256, first.runtime.configSha256);
    assert.equal((await configuration(dir)).allowLoopbackHttp, false); record = await runtimeRecord(dir);
    for (const origin of origins) await denied(origin);
    await allowed('https://aipoch.network');
    const preserved = await cli('setup'); assert.equal(preserved.action, 'unchanged');
    assert.equal((await configuration(dir)).allowLoopbackHttp, false);
    const explicit = await cli('setup', '--origin', pair.origin);
    assert.equal(explicit.action, 'restarted'); record = await runtimeRecord(dir);
    await allowed(pair.origin); await denied(origins[1]); await denied(origins[3]);
    assert.equal((await configuration(dir)).allowLoopbackHttp, false);
    assert.equal((await call('/v1/session', { origin: pair.origin, token: session.token })).status, 401);
    assert.equal((await call(`/v1/pairings/${pair.pairingId}`, { origin: pair.origin, token: pair.pollToken })).status, 410);
    assert.deepEqual(await cli('inbox', 'show', submission.requestId), durable);
    assert.deepEqual(await cli('operations', 'list'), history);
    assert.deepEqual(await adminRequest(dir, '/admin/associations?projectId=fixture-project'), [link]);
    const opened = await cli('setup', '--loopback-http', 'allow');
    assert.equal(opened.action, 'restarted'); record = await runtimeRecord(dir);
    for (const origin of origins) await allowed(origin);
    const finalConfig = await configuration(dir);
    assert.deepEqual(finalConfig.origins, ['https://aipoch.network', pair.origin]);
    assert.equal(finalConfig.allowLoopbackHttp, true);
    const legacy = { ...finalConfig }; delete legacy.allowLoopbackHttp;
    assert.equal(configurationDigest(finalConfig), configurationDigest(legacy));
    const legacyBytes = JSON.stringify(legacy, null, 2) + '\n';
    await writeFile(join(dir, 'config.json'), legacyBytes, { mode: 0o600 });
    assert.equal((await configuration(dir)).allowLoopbackHttp, true);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), legacyBytes);
    assert.deepEqual(await cli('inbox', 'show', submission.requestId), durable);
    assert.equal((await runtimeRecord(dir)).identity.runtimeId, opened.runtime.runtimeId);
    assert.ok(hostRequests.every(({ method, path }) => method === 'GET' || path.startsWith('/api/v1/connectors')),
      'The fixture must never receive research execution or project creation');
    return { mode: 'synthetic-public-sdk-http', localOrigins: origins.length, defaultAndDisabled: true,
      cliSetup: true, exactOriginIsolation: true, controlledRestart: true, durableReceiptSha256: receipt.contentSha256,
      associationsAndOperationsPreserved: true, browserTest: false };
  } finally {
    let stopped = !runtimeStarted;
    try {
      if (runtimeStarted) {
        await cli('stop');
        for (let i = 0; i < 200; i++) {
          try { await access(join(dir, 'runtime.lock')); } catch { stopped = true; break; }
          await pause();
        }
        assert.ok(stopped, 'Temporary Connector runtime must stop before fixture deletion');
      }
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
      // Preserve isolated recovery state if runtime shutdown cannot be confirmed.
      if (stopped) await rm(dir, { recursive: true, force: true });
    }
  }
}
