import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const execute = promisify(execFile);
export async function verifyAcquisition(root, source = false, live = false) {
  const dir = await mkdtemp(join(tmpdir(),'aipoch-cli-replay-'));
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
  const port=socket.address().port;await new Promise(r=>socket.close(()=>r()));
  const env={...process.env,NODE_OPTIONS:`--import=${fileURLToPath(new URL('./github-fixture.mjs',import.meta.url))}`,AIPOCH_TEST_REQUESTS:join(dir,'requests')};
  delete env.AIPOCH_GITHUB_TOKEN;
  if(live) delete env.NODE_OPTIONS;
  const command = source ? ['--import','tsx',join(root,'src/cli.ts')] : [join(root,'dist/cli.js')];
  const cli=async(...args)=>JSON.parse((await execute(process.execPath,[...command,...args,'--data-dir',dir],{env,cwd:root})).stdout);
  const stop=async()=>{await cli('stop');for(let i=0;i<100;i++){try{await access(join(dir,'runtime.lock'));}catch{return;}await new Promise(r=>setTimeout(r,20));}throw Error('Runtime did not stop');};
  await writeFile(join(dir,'config.json'),JSON.stringify({version:1,port,origins:['https://aipoch.network'],openScienceConfigRoot:join(dir,'absent-host')}));
  const hash=live ? 'bc9e74b6cd56bfbf4507473c5d417feb93c083b83f81f6cce59ed853f6f26657' : createHash('sha256').update('Synthetic MIT fixture\n').digest('hex');
  const args=['github','acquire',live?'https://github.com/imjszhang/aipoch-network':'https://github.com/example/research','--ref',live?'72419cdf51d56edd9d182b812218ef5aad7af2aa':'a'.repeat(40),'--path','LICENSE','--sha256',hash,'--destination',join(dir,'new'),'--operation-id','replay-1'];
  try {
    const first=await cli(...args);assert.equal(first.status,'files_acquired');
    const before=await stat(first.file);const original=await readFile(first.file);
    assert.equal(createHash('sha256').update(original).digest('hex'),hash);
    assert.deepEqual(await cli(...args),first);
    await stop();assert.deepEqual(await cli(...args),first);
    const after=await stat(first.file);assert.equal(after.ino,before.ino);assert.equal(after.mtimeMs,before.mtimeMs);assert.deepEqual(await readFile(first.file),original);
    if(!live) {const requests=(await readFile(join(dir,'requests'),'utf8')).split('\n');
    assert.equal(requests.filter(p=>p.includes('/git/blobs/')).length,1);}
    const changed=[...args];changed[changed.indexOf('--destination')+1]=join(dir,'other');
    await assert.rejects(cli(...changed),(e)=>JSON.parse(e.stderr.trim().split('\n').at(-1)).error.code==='operation_conflict');
    const record=await cli('operations','show','replay-1');
    assert.equal(record.state,'complete');assert.equal(record.identityVersion,'acquire-v1');
    assert.ok(record.input.source.resolvedAt);assert.ok(record.input.source.repositoryLicenseObservation.observedAt);
    const duplicate=[...args];duplicate[duplicate.indexOf('--operation-id')+1]='existing-target';
    await assert.rejects(cli(...duplicate),e=>JSON.parse(e.stderr.trim().split('\n').at(-1)).error.code==='destination_exists');
    const callsBefore=live?'':await readFile(join(dir,'requests'),'utf8');
    await stop();
    await assert.rejects(cli(...duplicate),e=>JSON.parse(e.stderr.trim().split('\n').at(-1)).error.code==='result_unconfirmed');
    const callsAfter=live?'':await readFile(join(dir,'requests'),'utf8');
    assert.equal(callsAfter.split('/git/blobs/').length,callsBefore.split('/git/blobs/').length);
    assert.equal((await cli('operations','show','existing-target')).outcome,'unknown');
    assert.equal((await stat(first.file)).mtimeMs,before.mtimeMs);
    // Real stdio handshake from the same executable and isolated running core.
    const require=createRequire(join(root,'package.json'));
    const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
    const {StdioClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
    const client=new Client({name:'package-acceptance',version:'1'});
    const transport=new StdioClientTransport({command:process.execPath,args:[...command,'mcp','--data-dir',dir],env,stderr:'pipe'});
    try {
      await client.connect(transport);
      const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
      assert.equal(client.getServerVersion().version,pkg.version);
      assert.equal((await cli('status')).runtime.packageVersion,pkg.version);
      assert.equal((await client.listTools()).tools.length,20);
      assert.equal((await client.callTool({name:'connection_status',arguments:{}})).isError,undefined);
    } finally {await client.close();}

    const {createMcpServer}=await import(pathToFileURL(join(root,source?'src/mcp.ts':'dist/mcp.js')).href);
    const {InMemoryTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/inMemory.js')).href);
    const opened=[];
    const preparedServer=createMcpServer(dir,{openConfirmation:url=>opened.push(url)});
    const reviewer=new Client({name:'preparation-acceptance',version:'1'});
    const [reviewTransport,serverTransport]=InMemoryTransport.createLinkedPair();
    try {
      await preparedServer.connect(serverTransport);await reviewer.connect(reviewTransport);
      const operationsBefore=await cli('operations','list');
      const result=await reviewer.callTool({name:'acquire_github_file',arguments:{source:record.input.source,destination:join(dir,'unapproved'),expectedSha256:hash}});
      assert.equal(result.isError,undefined);
      const prepared=JSON.parse(result.content[0].text);
      assert.equal(prepared.status,'waiting_for_user');assert.equal(opened.length,1);
      assert.ok(prepared.operationId);assert.ok(!result.content[0].text.includes('ticket='));
      await assert.rejects(access(join(dir,'unapproved')),{code:'ENOENT'});
      assert.deepEqual(await cli('operations','list'),operationsBefore);
      const pending=await reviewer.callTool({name:'get_action_result',arguments:{actionId:prepared.actionId}});
      assert.equal(JSON.parse(pending.content[0].text).status,'pending');
    }finally{await reviewer.close();await preparedServer.close();}
    return {mode:live?'live-anonymous-github':'synthetic-github',sha256:hash,bytes:original.length,replay:true,restart:true,noOverwrite:true,unknownNotRetried:true,mcpTools:20};
  } finally {await stop();await rm(dir,{recursive:true,force:true});}
}
