import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenScienceHost, type HostClient, type HostLifecycle } from '../src/workbench/index.js';

const lifecycle = (): HostLifecycle => ({
  running: true, configRoot: '/fixture/open-science', pid: 1234, port: 44100,
  startedAt: '2026-09-13T00:00:00.000Z', appVersion: '0.28.0',
});
const project = { id: 'host-project-1', name: 'Research', description: '', hasAgentContext: false,
  isExample: false, createdAt: 1, updatedAt: 1 };
function stub(overrides: Partial<HostClient> = {}): HostClient {
  return {
    health: async () => ({ appVersion: '0.28.0' }),
    listProjects: async () => [project],
    createProject: async () => project,
    listConnectors: async () => ({ connectors: [], customServers: [] }),
    addConnector: async input => ({ customServers: [{ ...input, enabled: false }] }),
    setConnectorEnabled: async () => ({}),
    ...overrides,
  } as unknown as HostClient;
}

test('host identity survives a restart while process identity changes', async () => {
  let state = lifecycle();
  const host = new OpenScienceHost({}, { client: stub(), readLifecycle: async () => state });
  const first = await host.status();
  assert.equal(first.ready, true);
  assert.equal(first.version, '0.28.0');
  assert.match(first.instanceId, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(first).includes('/fixture/'));
  state = { ...state, pid: 1235, startedAt: '2026-09-13T00:01:00.000Z' };
  const second = await host.status();
  assert.equal(first.hostId, second.hostId);
  assert.notEqual(first.instanceId, second.instanceId);
  state = { ...state, configRoot: '/fixture/another-host' };
  assert.notEqual((await host.status()).hostId, first.hostId);
});

test('absent or invalid lifecycle is never reported connected', async () => {
  let healthCalls = 0;
  const client = stub({ health: async () => { healthCalls++; return { appVersion: '0.28.0' }; } });
  for (const state of [{ running: false }, { running: true }]) {
    const host = new OpenScienceHost({}, { client, readLifecycle: async () => state });
    const status = await host.status();
    assert.equal(status.ready, false);
    assert.equal(status.instanceId, '');
  }
  assert.equal(healthCalls, 0);
});

test('host restart during readiness invalidates the probe', async () => {
  let calls = 0;
  const host = new OpenScienceHost({}, { client: stub(), readLifecycle: async () => ({
    ...lifecycle(), pid: ++calls === 1 ? 1234 : 1235,
  }) });
  assert.equal((await host.status()).reason, 'host_changed');
});

test('local endpoint is a discovery constraint, never an arbitrary token destination', async () => {
  for (const baseUrl of ['https://example.com', 'http://127.0.0.1.evil.test:44100',
    'http://user:password@localhost:44100', 'http://127.0.0.1:44100/path', 'file:///tmp/host']) {
    assert.throws(() => new OpenScienceHost({ baseUrl }), { code: 'host_endpoint_mismatch' });
  }
  const host = new OpenScienceHost({ baseUrl: 'http://127.0.0.1:44101' }, {
    client: stub(), readLifecycle: async () => lifecycle(),
  });
  assert.equal((await host.status()).reason, 'host_endpoint_mismatch');
});

test('project creation preserves intent and idempotency key without agent context or execution', async () => {
  const writes: unknown[] = [];
  const host = new OpenScienceHost({}, {
    client: stub({ createProject: async (body, options) => { writes.push({ body, options }); return project; } }),
    readLifecycle: async () => lifecycle(),
  });
  assert.deepEqual(await host.listProjects(), [{ id: project.id, name: project.name }]);
  assert.deepEqual(await host.createProject({ name: 'Reviewed name', description: 'Reviewed description',
    idempotencyKey: 'request-123' }), { id: project.id, name: project.name });
  assert.deepEqual(writes, [{ body: { name: 'Reviewed name', description: 'Reviewed description' },
    options: { timeoutMs: 5000, idempotencyKey: 'request-123' } }]);
});

test('project creation checks the expected host against the actual authenticated client before writing', async () => {
  let state = lifecycle();
  const writes: unknown[] = [];
  const connectedProfiles: Array<string | undefined> = [];
  const host = new OpenScienceHost({}, {
    connect: async options => {
      connectedProfiles.push(options.configRoot);
      return stub({ createProject: async (body, options) => { writes.push({ body, options }); return project; } });
    },
    readLifecycle: async () => state,
  });
  const reviewed = await host.status();
  state = { ...state, configRoot: '/fixture/another-host', pid: 6789 };
  await assert.rejects(host.createProject({ name: 'Reviewed name', expectedHostId: reviewed.hostId }), { code: 'host_changed' });
  assert.deepEqual(connectedProfiles, ['/fixture/open-science', '/fixture/another-host']);
  assert.equal(writes.length, 0);
  const current = await host.status();
  await host.createProject({ name: 'Reviewed name', expectedHostId: current.hostId, idempotencyKey: 'pinned-request' });
  assert.deepEqual(writes, [{ body: { name: 'Reviewed name' }, options: { timeoutMs: 5000, idempotencyKey: 'pinned-request' } }]);
});

test('uncertain host writes are not retried and do not leak error secrets', async () => {
  let writes = 0;
  const host = new OpenScienceHost({}, {
    client: stub({ createProject: async () => { writes++; throw new Error('Bearer secret /private/research'); } }),
    readLifecycle: async () => lifecycle(),
  });
  await assert.rejects(host.createProject({ name: 'Research', idempotencyKey: 'request-1' }), error => {
    assert.equal((error as { code: string }).code, 'host_outcome_unknown');
    assert.ok(!String(error).includes('secret'));
    return true;
  });
  assert.equal(writes, 1);
});

test('a restart after a write produces an unknown outcome, never a false success', async () => {
  let state = lifecycle();
  const host = new OpenScienceHost({}, {
    client: stub({ createProject: async () => { state = { ...state, pid: 9876 }; return project; } }),
    readLifecycle: async () => state,
  });
  await assert.rejects(host.createProject({ name: 'Research' }), { code: 'host_outcome_unknown' });
});

test('MCP registration is explicit, enables its exact entry, and rejects a conflicting command', async () => {
  const writes: unknown[] = [];
  const host = new OpenScienceHost({}, {
    client: stub({
      addConnector: async request => { writes.push(request); return { customServers: [{ ...request, enabled: false }] } as never; },
      setConnectorEnabled: async (id, enabled) => { writes.push({ id, enabled }); return {} as never; },
    }), readLifecycle: async () => lifecycle(),
  });
  assert.deepEqual(await host.registerMcp({ command: '/usr/bin/node', args: ['/connector/cli.js', 'mcp'] }),
    { id: 'aipoch-connector', name: 'aipoch-connector', enabled: true });
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], { id: 'aipoch-connector', enabled: true });
  const conflict = new OpenScienceHost({}, {
    client: stub({ listConnectors: async () => ({ customServers: [{
      id: 'aipoch-connector', name: 'aipoch-connector', transport: 'stdio', command: 'other', args: [], enabled: true,
    }] }) as never }), readLifecycle: async () => lifecycle(),
  });
  await assert.rejects(conflict.registerMcp({ command: 'node', args: [] }), { code: 'mcp_registration_conflict' });
});

test('MCP preflight reads report unsupported or unavailable APIs without claiming an uncertain write', async () => {
  for (const [status, code] of [[404, 'host_api_unsupported'], [503, 'host_unavailable']] as const) {
    let writes = 0;
    const host = new OpenScienceHost({}, {
      client: stub({
        listConnectors: async () => { throw Object.assign(new Error('upstream-private-details'), { status }); },
        addConnector: async () => { writes++; return {} as never; },
        setConnectorEnabled: async () => { writes++; return {} as never; },
      }), readLifecycle: async () => lifecycle(),
    });
    await assert.rejects(host.registerMcp({ command: 'node', args: [] }), { code });
    assert.equal(writes, 0);
  }
});

test('MCP failure after submitting a write remains an uncertain outcome', async () => {
  const host = new OpenScienceHost({}, {
    client: stub({ addConnector: async () => { throw new Error('connection closed after submission'); } }),
    readLifecycle: async () => lifecycle(),
  });
  await assert.rejects(host.registerMcp({ command: 'node', args: [] }), { code: 'host_outcome_unknown' });
});

test('vendored public SDK and CLI authenticate against an isolated HTTP fixture', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aipoch-host-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const token = randomBytes(32).toString('hex');
  const requests: Array<{ method?: string; url?: string; body?: unknown; key?: string }> = [];
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end(); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, ...(body ? { body: JSON.parse(body) } : {}),
      ...(req.headers['idempotency-key'] ? { key: String(req.headers['idempotency-key']) } : {}) });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/bootstrap') res.end(JSON.stringify({ appVersion: '0.28.0' }));
    else if (req.url === '/api/v1/projects') res.end(JSON.stringify({ data: req.method === 'POST' ? project : [project] }));
    else { res.writeHead(404); res.end(JSON.stringify({ error: { code: 'not_found' } })); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
  }));
  const port = (server.address() as { port: number }).port;
  await writeFile(join(root, 'web-token'), token, { mode: 0o600 });
  const state = { pid: process.pid, port, startedAt: '2026-09-13T00:00:00.000Z', appVersion: '0.28.0' };
  await writeFile(join(root, 'web-service.json'), JSON.stringify(state), { mode: 0o600 });
  const host = new OpenScienceHost({ configRoot: root, baseUrl: `http://127.0.0.1:${port}` });
  const first = await host.status();
  assert.equal(first.ready, true);
  assert.deepEqual(await host.listProjects(), [{ id: project.id, name: project.name }]);
  await host.createProject({ name: 'Research', idempotencyKey: 'fixture-key' });
  assert.deepEqual(requests.find(request => request.method === 'POST'), {
    method: 'POST', url: '/api/v1/projects', body: { name: 'Research' }, key: 'fixture-key',
  });
  await writeFile(join(root, 'web-service.json'), JSON.stringify({ ...state, startedAt: '2026-09-13T00:01:00.000Z' }));
  const restarted = await host.status();
  assert.equal(restarted.hostId, first.hostId);
  assert.notEqual(restarted.instanceId, first.instanceId);
  assert.ok(requests.every(request => request.url === '/api/bootstrap' || request.url === '/api/v1/projects'));
  assert.ok(!JSON.stringify(first).includes(token));
});

test('vendored distribution files match their pinned provenance hashes', async () => {
  const directory = new URL('../vendor/open-science/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('ORIGIN.json', directory), 'utf8'));
  assert.equal(manifest.commit, '9abd170b5269c650a9af7e3e3701ab378d05e153');
  for (const [name, hash] of Object.entries(manifest.files)) {
    assert.equal(createHash('sha256').update(await readFile(new URL(name, directory))).digest('hex'), hash, name);
  }
  assert.deepEqual(await readFile(new URL('index.d.mts', directory)), await readFile(new URL('index.d.ts', directory)));
});
