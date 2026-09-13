import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Inbox } from '../src/inbox.js';
import { ConnectorCore } from '../src/core.js';
import { ConnectorError, digest, type Host } from '../src/contracts.js';
import { createMcpServer } from '../src/mcp.js';

test('operation evidence survives database reopening; querying unknown outcomes never starts a write', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aipoch-operation-recovery-'));
  const path = join(dir, 'inbox.sqlite'); let inbox = new Inbox(path); let creates = 0;
  const host: Host = { status: async () => ({ready:true, hostId:'host-1', instanceId:'epoch-1'}),
    listProjects: async () => [], createProject: async () => {creates++; throw new Error('reply lost');} };
  const input = {operationId:'project-uncertain', name:'Reviewed project', expectedHostId:'host-1'};
  try {
    await assert.rejects(new ConnectorCore(inbox, host).createProject(input), /reply lost/);
    inbox.beginOperation('file-complete', digest('file-input'));
    const result = {destination:'/synthetic/research/README.md', sha256:'a'.repeat(64)};
    inbox.finishOperation('file-complete', result);
    inbox.close(); inbox = new Inbox(path);
    assert.deepEqual(inbox.getOperation(input.operationId), {operationId:input.operationId,
      inputHash:digest(JSON.stringify(input)), state:'pending', result:undefined, outcome:'unknown', retryAllowed:false});
    assert.deepEqual(inbox.getOperation('file-complete'), {operationId:'file-complete', inputHash:digest('file-input'),
      state:'complete', result, outcome:'complete', retryAllowed:false});
    assert.deepEqual(inbox.listOperations().map(row => row.operationId), ['file-complete','project-uncertain']);
    assert.equal(inbox.listOperations(1)[0].operationId, 'file-complete');
    assert.equal(inbox.getOperation('never-started'), undefined);
    assert.equal(inbox.listOperations().length, 2);
    await assert.rejects(new ConnectorCore(inbox, host).createProject(input), {code:'result_unconfirmed'});
    assert.equal(creates, 1);
  } finally { inbox.close(); rmSync(dir, {recursive:true, force:true}); }
});

test('recovery reads reject invalid identifiers and bounds without inserting records', () => {
  const inbox = new Inbox(':memory:');
  try {
    for (const id of ['', 'a/b', 'a'.repeat(101), "'; DELETE FROM operations;"])
      assert.throws(() => inbox.getOperation(id), {code:'operation_id_required'});
    for (const limit of [0, -1, 101, NaN, Infinity, 1.5])
      assert.throws(() => inbox.listOperations(limit), {code:'invalid_limit'});
    assert.deepEqual(inbox.listOperations(), []);
  } finally { inbox.close(); }
});

test('MCP operation tools use read-only owner routes and preserve unknown outcomes', async () => {
  const inbox = new Inbox(':memory:'); inbox.beginOperation('uncertain-1', digest('reviewed action'));
  const calls: Array<{path:string; method:string}> = [];
  const server = createMcpServer('/synthetic/owner', {openConfirmation: () => {throw new Error('Read must not open approval');},
    request: async (_directory, path, method='GET', body) => {
      calls.push({path, method}); assert.equal(method, 'GET'); assert.equal(body, undefined);
      if (path === '/admin/operations') return inbox.listOperations();
      const record = inbox.getOperation(decodeURIComponent(path.slice('/admin/operations/'.length)));
      if (!record) throw new ConnectorError('operation_missing', 'No operation record was found. Inspect actual results before considering another write.', 404);
      return record;
    }});
  const client = new Client({name:'recovery-test', version:'1.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const {tools} = await client.listTools();
    for (const name of ['list_operations','get_operation']) {
      const tool = tools.find(row => row.name === name)!;
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.match(tool.description!, /unknown/i);
    }
    const decode = (result:any) => JSON.parse(result.content[0].text);
    const list = decode(await client.callTool({name:'list_operations', arguments:{}}));
    const record = decode(await client.callTool({name:'get_operation', arguments:{operationId:'uncertain-1'}}));
    assert.deepEqual(record, list[0]); assert.equal(record.outcome, 'unknown'); assert.equal(record.retryAllowed, false);
    const missing = await client.callTool({name:'get_operation', arguments:{operationId:'missing'}});
    assert.equal(missing.isError, true); assert.equal(decode(missing).error.code, 'operation_missing');
    const count = calls.length;
    const invalid = await client.callTool({name:'get_operation', arguments:{operationId:'invalid/id'}});
    assert.equal(invalid.isError, true); assert.equal(calls.length, count);
    assert.deepEqual(calls, [{path:'/admin/operations', method:'GET'}, {path:'/admin/operations/uncertain-1', method:'GET'},
      {path:'/admin/operations/missing', method:'GET'}]);
    assert.equal(inbox.listOperations().length, 1);
  } finally { await client.close(); await server.close(); inbox.close(); }
});

test('MCP preparation returns the durable operation ID without exposing the local approval ticket', async () => {
  const privateUrl = 'http://127.0.0.1:47821/local/confirm?ticket=synthetic-private-ticket';
  const opened: string[] = [];
  const server = createMcpServer('/synthetic/owner', {openConfirmation:url => {opened.push(url);},
    request:async (_directory, path, method, input:any) => {
      assert.equal(path, '/admin/actions'); assert.equal(method, 'POST'); assert.equal(input.kind, 'acquire_github_file');
      return {actionId:'review-1', operationId:'file-durable-1', expiresAt:9999, url:privateUrl};
    }});
  const client = new Client({name:'correlation-test', version:'1.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const result = await client.callTool({name:'acquire_github_file', arguments:{source:{url:'https://github.com/example/public'},
      destination:'/synthetic/new-directory', expectedSha256:'a'.repeat(64)}});
    const text = (result.content as Array<{text:string}>)[0].text;
    const prepared = JSON.parse(text);
    assert.equal(prepared.operationId, 'file-durable-1'); assert.equal(prepared.actionId, 'review-1');
    assert.equal(prepared.status, 'waiting_for_user'); assert.deepEqual(opened, [privateUrl]);
    assert.doesNotMatch(text, /synthetic-private-ticket|local\/confirm/);
  } finally { await client.close(); await server.close(); }
});
