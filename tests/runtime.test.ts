import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { adminRequest, configuration, DEFAULT_GITHUB_CLIENT_ID, configurationDigest, ensureRuntime, runtimeRecord, runtimeVersion, saveConfiguration,
  type Configuration, type RuntimeIdentity } from '../src/runtime.js';
import { Inbox } from '../src/inbox.js';
import { digest } from '../src/contracts.js';
import { realpath } from 'node:fs/promises';

const pause = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
async function unusedPort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as {port: number}).port;
  await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
async function temporary() {
  const dir = await mkdtemp(join(tmpdir(), 'aipoch-runtime-'));
  const config: Configuration = { version: 1, port: await unusedPort(), origins: ['https://aipoch.network'], allowLoopbackHttp:false,
    openScienceConfigRoot: join(dir, 'no-running-host') };
  await saveConfiguration(dir, config); return {dir, config};
}
async function stop(dir: string) {
  try { await adminRequest(dir, '/admin/shutdown', 'POST', {}); } catch { /* A failed start has no runtime. */ }
  for (let i = 0; i < 100; i++) {
    try { await access(join(dir, 'runtime.lock')); } catch { return; }
    await pause();
  }
  throw new Error('Temporary runtime did not stop cleanly.');
}
async function cors(dir: string, origin: string) {
  const record = await runtimeRecord(dir);
  return fetch(record.url + '/v1/pairings', { method: 'OPTIONS', headers: { Origin: origin,
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }, signal: AbortSignal.timeout(2_000) });
}

test('new and existing configurations default to the public App while preserving overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aipoch-config-'));
  try {
    assert.equal((await configuration(dir)).githubClientId, DEFAULT_GITHUB_CLIENT_ID);
    const legacy: Configuration = {version:1, port:47821, origins:['https://aipoch.network']};
    await saveConfiguration(dir, legacy);
    const before = await readFile(join(dir, 'config.json'), 'utf8');
    const loaded = await configuration(dir);
    assert.equal(loaded.githubClientId, DEFAULT_GITHUB_CLIENT_ID);
    assert.equal(configurationDigest(legacy), configurationDigest(loaded));
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), before);
    await saveConfiguration(dir, {...legacy, githubClientId:'custom-client'});
    assert.equal((await configuration(dir)).githubClientId, 'custom-client');
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('configuration digest normalizes origin order and detects every startup setting', () => {
  const config: Configuration = {version:1, port:47821, origins:['https://aipoch.network', 'http://127.0.0.1:4193']};
  assert.equal(configurationDigest(config), configurationDigest({...config, origins:[...config.origins].reverse()}));
  assert.equal(configurationDigest(config), configurationDigest({...config, origins:[...config.origins, config.origins[0]]}));
  for (const patch of [{allowLoopbackHttp:false}, {port:47822}, {origins:['https://aipoch.network']}, {githubClientId:'test-client'},
    {openScienceConfigRoot:'/tmp/another-host'}, {catalogManifestUrl:'https://example.com/manifest.json'}])
    assert.notEqual(configurationDigest(config), configurationDigest({...config,...patch}));
});

test('running runtime applies origin, client ID, host profile and port updates immediately and preserves inbox', {timeout:40_000}, async () => {
  const {dir, config} = await temporary();
  try {
    const seeded=new Inbox(join(dir,'inbox.sqlite'));
    seeded.beginOperation('pending-recovery',digest('fixture operation')); seeded.close();
    const first = await ensureRuntime(dir);
    assert.equal(first.action, 'started');
    assert.equal((await ensureRuntime(dir)).action, 'unchanged');
    assert.equal((await cors(dir, 'http://127.0.0.1:4193')).status, 403);
    const changed = {...config, origins:[...config.origins, 'http://127.0.0.1:4193'], githubClientId:'fixture-client',
      openScienceConfigRoot:join(dir, 'different-no-running-host'), catalogManifestUrl:'https://example.com/manifest.json'};
    await saveConfiguration(dir, changed);
    const next = await ensureRuntime(dir);
    assert.equal(next.action, 'restarted'); assert.equal(next.configurationApplied, true);
    assert.notEqual(next.runtime.runtimeId, first.runtime.runtimeId);
    assert.equal(next.runtime.configSha256, configurationDigest(changed));
    assert.equal((await cors(dir, 'http://127.0.0.1:4193')).status, 204);
    assert.deepEqual(await adminRequest(dir, '/admin/inbox'), []);
    const operation=await adminRequest(dir,'/admin/operations/pending-recovery');
    assert.equal(operation.state,'pending'); assert.equal(operation.outcome,'unknown');
    assert.equal(operation.retryAllowed,false);
    assert.equal((await adminRequest(dir,'/admin/operations'))[0].operationId,'pending-recovery');
    const lastConfig = {...changed, port:await unusedPort()};
    await saveConfiguration(dir, lastConfig);
    const last = await ensureRuntime(dir);
    assert.equal(last.action, 'restarted');
    assert.equal((await runtimeRecord(dir)).url, `http://127.0.0.1:${lastConfig.port}`);
    assert.equal(last.runtime.configSha256, configurationDigest(lastConfig));
    assert.equal((await ensureRuntime(dir)).action, 'unchanged');
  } finally { await stop(dir); await rm(dir, {recursive:true, force:true}); }
});

test('concurrent ensures start one runtime and converge on the same instance', {timeout:20_000}, async () => {
  const {dir} = await temporary();
  try {
    const values = await Promise.all([ensureRuntime(dir), ensureRuntime(dir), ensureRuntime(dir)]);
    assert.equal(values.filter(value=>value.action==='started').length, 1);
    assert.equal(new Set(values.map(value=>value.runtime.runtimeId)).size, 1);
  } finally { await stop(dir); await rm(dir, {recursive:true, force:true}); }
});

test('copied discovery for another data directory cannot trigger its shutdown', {timeout:20_000}, async () => {
  const first = await temporary(), second = await temporary();
  try {
    const running = await ensureRuntime(first.dir);
    await writeFile(join(second.dir, 'runtime.json'), await readFile(join(first.dir, 'runtime.json')), {mode:0o600});
    await assert.rejects(ensureRuntime(second.dir), {code:'runtime_identity_unconfirmed'});
    assert.equal((await adminRequest(first.dir, '/admin/runtime')).runtimeId, running.runtime.runtimeId);
  } finally { await stop(first.dir); await rm(first.dir, {recursive:true,force:true}); await rm(second.dir, {recursive:true,force:true}); }
});

test('legacy identity cannot be silently taken over', {timeout:20_000}, async () => {
  const {dir} = await temporary();
  try {
    const running = await ensureRuntime(dir);
    const record = await runtimeRecord(dir);
    await writeFile(join(dir, 'runtime.json'), JSON.stringify({pid:record.pid,url:record.url,token:record.token}), {mode:0o600});
    await assert.rejects(ensureRuntime(dir), {code:'runtime_identity_unconfirmed'});
    assert.equal((await adminRequest(dir, '/admin/runtime')).runtimeId, running.runtime.runtimeId);
  } finally { await stop(dir); await rm(dir, {recursive:true,force:true}); }
});

test('an authenticated older runtime version is replaced and the replacement version is verified', {timeout:20_000}, async () => {
  const {dir, config} = await temporary();
  const expected = await runtimeVersion();
  const identity: RuntimeIdentity = {identityVersion:1, runtimeId:'fixture-older-build', pid:0,
    dataDirectoryId:digest(await realpath(dir)), configSha256:configurationDigest(config),
    ...expected, codeSha256:'0'.repeat(64)};
  // Controlled owner-only fake runtime models an old installed build; no host is discovered or launched.
  const script = `
    const {createServer}=require('node:http'); const fs=require('node:fs');
    const dir=process.argv[1], port=Number(process.argv[2]), identity=JSON.parse(process.argv[3]);
    identity.pid=process.pid; const token='runtime-test-owner-token-12345678901234567890';
    const server=createServer((req,res)=>{
      if(req.headers.authorization!=='Bearer '+token){res.writeHead(401).end('{}');return;}
      res.setHeader('content-type','application/json');
      if(req.url==='/admin/runtime'){res.end(JSON.stringify(identity));return;}
      if(req.url==='/admin/shutdown' && req.method==='POST'){
        fs.writeFileSync(dir+'/shutdown-observed','yes');res.end('{}');
        setTimeout(()=>{fs.unlinkSync(dir+'/runtime.json');server.close(()=>process.exit(0));},25);return;
      }
      res.writeHead(404).end('{}');
    });
    server.listen(port,'127.0.0.1',()=>{
      fs.writeFileSync(dir+'/runtime.json',JSON.stringify({pid:process.pid,url:'http://127.0.0.1:'+port,token,identity}),{mode:0o600});
      process.stdout.write('ready\\n');
    });`;
  const fake = spawn(process.execPath, ['-e', script, dir, String(config.port), JSON.stringify(identity)], {stdio:['ignore','pipe','inherit']});
  try {
    await once(fake.stdout!, 'data');
    const next = await ensureRuntime(dir);
    assert.equal(next.action, 'restarted');
    assert.equal(await readFile(join(dir,'shutdown-observed'),'utf8'), 'yes');
    assert.equal(next.runtime.codeSha256, expected.codeSha256);
    assert.equal(next.runtime.packageVersion, expected.packageVersion);
    assert.notEqual(next.runtime.runtimeId, identity.runtimeId);
  } finally { await stop(dir); await rm(dir, {recursive:true,force:true}); }
});

test('CLI status distinguishes missing runtime from authentication failure without starting another', {timeout:20_000}, async () => {
  const {dir} = await temporary();
  const runStatus = async () => {
    const child=spawn(process.execPath,['--import','tsx','src/cli.ts','status','--data-dir',dir],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
    const [code]=await once(child,'close');return {code,stdout,stderr};
  };
  let original='';
  try {
    const absent=await runStatus(); assert.equal(absent.code,1);assert.equal(JSON.parse(absent.stdout).running,false);
    const running=await ensureRuntime(dir);original=await readFile(join(dir,'runtime.json'),'utf8');
    const record=JSON.parse(original);record.token='incorrect-owner-token-12345678901234567890';
    await writeFile(join(dir,'runtime.json'),JSON.stringify(record),{mode:0o600});
    const denied=await runStatus();assert.equal(denied.code,1);assert.equal(denied.stdout,'');
    assert.equal(JSON.parse(denied.stderr.trim().split('\n').at(-1)!).error.code,'unauthorized');
    await writeFile(join(dir,'runtime.json'),original,{mode:0o600});
    assert.equal((await adminRequest(dir,'/admin/runtime')).runtimeId,running.runtime.runtimeId);
  } finally {
    if(original)await writeFile(join(dir,'runtime.json'),original,{mode:0o600});
    await stop(dir);await rm(dir,{recursive:true,force:true});
  }
});
