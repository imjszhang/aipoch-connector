import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectorCore } from '../src/core.js';
import { Inbox } from '../src/inbox.js';
import { digest, parseSubmission, type Host } from '../src/contracts.js';
import { createBridge } from '../src/bridge.js';

const origin='https://aipoch.network';
function fixture() {
  let epoch='process-1', ready=true, creates=0;
  const host: Host={status:async()=>({ready,instanceId:epoch,hostId:'workspace-1'}),listProjects:async()=>[{id:'project-1',name:'Research'}],
    createProject:async({name})=>{creates++;return{id:'new-project',name};}};
  return {host,restart:()=>{epoch='process-2';},stop:()=>{ready=false;},creates:()=>creates};
}
function submission(sessionId: string, requestId='reference-1') {
  const content=JSON.stringify({format:'aipoch-network-internal-review-1',object:{id:'project:test',kind:'project',title:'Example'},action:'Open',target:'Open-Science',public_location:'https://aipoch.network/projects/project~test/',snapshot:{id:'snapshot-1',generated_at:'2026-09-13T00:00:00.000Z'},sources:[{id:'source:github:1',role:'primary',url:'https://github.com/example/research',reference_url:null,availability:'accessible',commit:'a'.repeat(40),named_reference:null,path:null,version_status:'fixed',path_status:'not_supplied',sha256:null,resolved_at:null,archived:false,stale:false,observed_at:'2026-09-13T00:00:00.000Z',license:{status:'unknown'}}],license:{status:'per_source',conditions:'Each source retains its own license and conditions.'},conditions:[]},null,2);
  return {protocolVersion:'1.0',requestId,sessionId,objectId:'project:test',action:'receive_reference',review:{format:'aipoch-network-internal-review-1',content,sha256:digest(content)}};
}
async function connect(core: ConnectorCore) {
  const pairing=await core.pair(origin,'attempt-1');
  await core.approvePairing(pairing.pairingId,pairing.verificationCode,origin);
  const result=await core.pollPairing(pairing.pairingId,pairing.pollToken,origin);
  assert.equal(result.status,'approved'); return result.session!;
}
test('exact reviewed bytes survive durable receipt, replay and restart',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'aipoch-inbox-')); const path=join(dir,'inbox.sqlite');
  const f=fixture(); let inbox=new Inbox(path); const core=new ConnectorCore(inbox,f.host);
  try {
    const session=await connect(core), input=submission(session.id);
    const first=await core.receive(input,session.token,origin);
    assert.deepEqual(await core.receive(input,session.token,origin),first);
    assert.equal(inbox.list().length,1); assert.equal(f.creates(),0);
    const changed=structuredClone(input); changed.review.content+=' '; changed.review.sha256=digest(changed.review.content);
    await assert.rejects(core.receive(changed,session.token,origin),/already refers/);
    inbox.close(); inbox=new Inbox(path);
    assert.equal(inbox.get(first.requestId)?.submission.review.content,input.review.content);
  } finally { inbox.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('pairing proof, origin, host restart and disconnect revoke authority',async()=>{
  const f=fixture(), inbox=new Inbox(':memory:'), core=new ConnectorCore(inbox,f.host);
  try {
    const pair=await core.pair(origin,'a');
    await assert.rejects(core.approvePairing(pair.pairingId,'WRONG',origin));
    await assert.rejects(core.pollPairing(pair.pairingId,pair.pollToken,'https://evil.example'));
    const session=await connect(core);
    await assert.rejects(core.receive(submission(session.id),session.token,'https://evil.example'));
    f.restart(); await assert.rejects(core.session(session.token,origin));
    const second=await connect(core); await core.disconnect(second.token,origin);
    await assert.rejects(core.receive(submission(second.id),second.token,origin));
  } finally {inbox.close();}
});
test('review identity/digest/private sources are rejected, no automatic host writes',()=>{
  const input=submission('s'); const wrong=structuredClone(input); wrong.objectId='project:other';
  assert.throws(()=>parseSubmission(wrong));
  wrong.objectId=input.objectId; wrong.review.sha256='0'.repeat(64); assert.throws(()=>parseSubmission(wrong));
  const review=JSON.parse(input.review.content); review.sources[0].availability='private'; input.review.content=JSON.stringify(review); input.review.sha256=digest(input.review.content);
  assert.throws(()=>parseSubmission(input));
});
test('uncertain host creation is journaled and never silently repeated',async()=>{
  const inbox=new Inbox(':memory:'); let calls=0;
  const host={...fixture().host,createProject:async()=>{calls++;throw new Error('reply lost');}};
  const core=new ConnectorCore(inbox,host); const input={operationId:'op-1',name:'Research',expectedHostId:'workspace-1'};
  try {
    await assert.rejects(core.createProject(input)); await assert.rejects(core.createProject(input),/may have succeeded/); assert.equal(calls,1);
  } finally {inbox.close();}
});
test('associations retain stable workbench identity across host restart',async()=>{
  const f=fixture(), inbox=new Inbox(':memory:'),core=new ConnectorCore(inbox,f.host);
  try {
    const session=await connect(core); await core.receive(submission(session.id),session.token,origin);
    await core.associate('reference-1','project-1','workspace-1'); f.restart();
    assert.equal(inbox.links('project-1','workspace-1').length,1);
    await assert.rejects(core.associate('reference-1','project-1','different-workbench'));
  } finally {inbox.close();}
});
test('real HTTP bridge separates browser pairing, owner administration and receipts',async()=>{
  const f=fixture(),inbox=new Inbox(':memory:'),core=new ConnectorCore(inbox,f.host);
  const server=createBridge(core,{adminToken:'owner-secret-for-tests',origins:[origin]});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${(server.address() as any).port}`;
  const call=(path:string,method='GET',data?:unknown,token?:string,website:string|undefined=origin)=>fetch(url+path,{method,headers:{...(website?{Origin:website}:{}),...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});
  try {
    assert.equal((await call('/admin/inbox','GET',undefined,'owner-secret-for-tests')).status,401);
    assert.equal((await call('/v1/pairings','POST',{protocolVersion:'1.0',attemptId:'x'},undefined,'https://evil.example')).status,403);
    const pair=await (await call('/v1/pairings','POST',{protocolVersion:'1.0',attemptId:'x'})).json() as any;
    assert.equal((await (await call(`/v1/pairings/${pair.pairingId}`,'GET',undefined,pair.pollToken)).json() as any).status,'pending');
    const approval=await call(`/admin/pairings/${pair.pairingId}/approve`,'POST',{code:pair.verificationCode,origin},'owner-secret-for-tests','');
    assert.equal(approval.status,200);
    const {session}=await (await call(`/v1/pairings/${pair.pairingId}`,'GET',undefined,pair.pollToken)).json() as any;
    const response=await call('/v1/references','POST',submission(session.id),session.token);
    assert.equal(response.status,200); assert.equal((await response.json() as any).outcome,'received');
    assert.equal((await call('/v1/receipts/reference-1','GET',undefined,session.token)).status,200);
    f.stop(); assert.equal((await call('/v1/session','GET',undefined,session.token)).status,503);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));inbox.close();}
});
test('MCP action preparation never executes; local approval is single-use and origin-bound',async()=>{
  const inbox=new Inbox(':memory:'),core=new ConnectorCore(inbox,fixture().host);let writes=0;
  const server=createBridge(core,{adminToken:'local-test-owner',origins:[origin],prepareAction:async(_kind,input)=>{
    const exact=structuredClone(input);return{display:exact,execute:async()=>{writes++;return{target:exact.projectId};}};
  }});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const prepared=await(await fetch(url+'/admin/actions',{method:'POST',headers:{Authorization:'Bearer local-test-owner','Content-Type':'application/json'},body:JSON.stringify({kind:'associate_reference',input:{projectId:'approved-project'}})})).json() as any;
    assert.equal(writes,0);assert.equal((await fetch(prepared.url)).status,200);assert.equal(writes,0);
    assert.equal((await fetch(prepared.url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'decision=approve'})).status,403);
    assert.equal(writes,0);
    assert.equal((await fetch(prepared.url,{method:'POST',headers:{Origin:url,'Content-Type':'application/x-www-form-urlencoded'},body:'decision=approve'})).status,200);
    assert.equal(writes,1);
    assert.equal((await fetch(prepared.url,{method:'POST',headers:{Origin:url,'Content-Type':'application/x-www-form-urlencoded'},body:'decision=approve'})).status,410);
    const result=await(await fetch(url+`/admin/actions/${prepared.actionId}`,{headers:{Authorization:'Bearer local-test-owner'}})).json() as any;
    assert.equal(result.status,'complete');assert.equal(result.result.target,'approved-project');assert.equal(writes,1);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));inbox.close();}
});
