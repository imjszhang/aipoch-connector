import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectorCore } from '../src/core.js';
import { Inbox } from '../src/inbox.js';
import { digest, type Host, type HostStatus } from '../src/contracts.js';

const input = { operationId: 'pinned-host-operation', name: 'Reviewed project', expectedHostId: 'host-A' };
function fixture(afterWrite?: () => HostStatus) {
  let status: HostStatus = { ready: true, hostId: 'host-A', instanceId: 'epoch-A' };
  const requests: unknown[] = [];
  const host: Host = {
    status: async () => status, listProjects: async () => [],
    createProject: async request => {
      requests.push(request);
      if (afterWrite) status = afterWrite();
      return { id: 'actual-project', name: request.name };
    },
  };
  const inbox = new Inbox(':memory:');
  return { core: new ConnectorCore(inbox, host), inbox, requests,
    reset: () => { status = { ready: true, hostId: 'host-A', instanceId: 'epoch-A' }; } };
}

test('core forwards the reviewed host pin and completes only with matching post-write evidence', async () => {
  const f = fixture();
  try {
    const result = await f.core.createProject(input);
    assert.deepEqual(f.requests, [{ name: input.name, description: undefined,
      idempotencyKey: input.operationId, expectedHostId: input.expectedHostId }]);
    assert.deepEqual(result, { project: { id: 'actual-project', name: input.name }, hostId: 'host-A' });
    assert.equal(f.inbox.beginOperation(input.operationId, digest(JSON.stringify(input))).state, 'complete');
    assert.deepEqual(await f.core.createProject(input), result);
    assert.equal(f.requests.length, 1);
  } finally { f.inbox.close(); }
});

test('different host, restarted process, or unavailable host after creation preserves an unknown operation', async () => {
  for (const changed of [
    { ready: true, hostId: 'host-B', instanceId: 'epoch-A' },
    { ready: true, hostId: 'host-A', instanceId: 'epoch-B' },
    { ready: false, hostId: 'host-A', instanceId: 'epoch-A' },
  ]) {
    const f = fixture(() => changed);
    try {
      await assert.rejects(f.core.createProject(input), { code: 'result_unconfirmed' });
      assert.deepEqual(f.inbox.beginOperation(input.operationId, digest(JSON.stringify(input))), { state: 'pending', result: undefined });
      f.reset();
      await assert.rejects(f.core.createProject(input), { code: 'result_unconfirmed' });
      assert.equal(f.requests.length, 1);
    } finally { f.inbox.close(); }
  }
});
