import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,rmSync,statSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ConnectorCore} from '../src/core.js';
import {Inbox} from '../src/inbox.js';
import {AuthorizationStore,AUTHORIZATION_IDLE_TTL,CHALLENGE_TTL,parseBrowserAuthorization} from '../src/authorizations.js';
import {createBridge} from '../src/bridge.js';

const origin='https://aipoch.network';
function key(name='Firefox'){
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'});
  return {privateKey:pair.privateKey,browser:{version:'1.0',publicKey:{kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y},browserName:name}};
}
function fixture(path=':memory:'){
  let now=1_000,ready=true,instanceId='instance-1',hostId='host-1',gate:Promise<void>|undefined,release=()=>{};
  const host={status:async()=>{await gate;return {ready,instanceId,hostId};},listProjects:async()=>[],createProject:async()=>{throw new Error('No research writes in connection tests');}};
  const inbox=new Inbox(':memory:'),store=new AuthorizationStore(path),core=new ConnectorCore(inbox,host,()=>now,undefined,store);
  return {inbox,store,core,host,now:()=>now,setNow:(value:number)=>{now=value;},stop:()=>{ready=false;},start:()=>{ready=true;instanceId+='-restart';},changeHost:()=>{hostId='host-2';instanceId='instance-2';},
    pause:()=>{gate=new Promise<void>(resolve=>{release=resolve;});},release:()=>{gate=undefined;release();},close:()=>{store.close();inbox.close();}};
}
async function connect(f:ReturnType<typeof fixture>,k=key(),remember=true){
  const pair=await f.core.pair(origin,'test',k.browser);
  await f.core.approvePairing(pair.pairingId,pair.verificationCode,origin,remember);
  const result=await f.core.pollPairing(pair.pairingId,pair.pollToken,origin);
  return {...result,key:k,pair};
}
function proof(f:ReturnType<typeof fixture>,id:string,k:ReturnType<typeof key>,purpose='resume'){
  const challenge=f.core.authorizationChallenge(id,origin,{version:'1.0',connectorId:f.store.connectorId,purpose});
  return {version:'1.0',connectorId:f.store.connectorId,challengeId:challenge.challengeId,
    signature:sign('sha256',Buffer.from(challenge.challenge),{key:k.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')};
}
test('persistent approval captures immutable valid public key; omitted remember stays session-only',async()=>{
  const f=fixture();try{
    const k=key(),pair=await f.core.pair(origin,'immutable',k.browser);k.browser.publicKey=key().browser.publicKey;
    await f.core.approvePairing(pair.pairingId,pair.verificationCode,origin,true);
    const approved=await f.core.pollPairing(pair.pairingId,pair.pollToken,origin);
    assert.ok(approved.authorization);assert.equal(f.store.list(f.now()).length,1);
    const resumed=await f.core.resumeAuthorization(approved.authorization.id,origin,proof(f,approved.authorization.id,k));
    assert.notEqual(resumed.session.id,approved.session!.id);
    const once=await connect(f,key(),false);assert.equal(once.authorization,undefined);assert.equal(f.store.list(f.now()).length,1);
    const legacy=await f.core.pair(origin,'legacy');await f.core.approvePairing(legacy.pairingId,legacy.verificationCode,origin);
    assert.equal((await f.core.pollPairing(legacy.pairingId,legacy.pollToken,origin)).authorization,undefined);
    assert.throws(()=>parseBrowserAuthorization({...key().browser,publicKey:{...key().browser.publicKey,d:'private'}}),{code:'invalid_browser_key'});
    assert.throws(()=>parseBrowserAuthorization({...key().browser,publicKey:{kty:'EC',crv:'P-256',x:'A'.repeat(43),y:'A'.repeat(43)}}),{code:'invalid_browser_key'});
  }finally{f.close();}
});
test('normal Connector restart preserves identity/grant and issues a new session while old token fails',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'aipoch-authorization-')),path=join(dir,'authorizations.sqlite');let f=fixture(path);
  try{
    const approved=await connect(f),id=approved.authorization!.id,connectorId=f.store.connectorId;
    const staleProof=proof(f,id,approved.key);f.close();f=fixture(path);
    assert.equal(f.store.connectorId,connectorId);assert.equal(statSync(path).mode&0o777,0o600);
    await assert.rejects(f.core.session(approved.session!.token,origin),{code:'unauthorized'});
    await assert.rejects(f.core.resumeAuthorization(id,origin,staleProof),{code:'challenge_expired'});
    const result=await f.core.resumeAuthorization(id,origin,proof(f,id,approved.key));assert.notEqual(result.session.id,approved.session!.id);
    assert.equal((await f.core.session(result.session.token,origin)).authorizationId,id);
    assert.equal(readFileSync(path).includes(Buffer.from(approved.session!.token)),false);
  }finally{f.close();rmSync(dir,{recursive:true,force:true});}
});
test('valid identity proof preserves grant while host is offline; failed proof cannot claim remembered state or extend last use',async()=>{
  const f=fixture();try{
    const a=await connect(f),id=a.authorization!.id;f.setNow(5_000);f.stop();
    const wrong=proof(f,id,key());await assert.rejects(f.core.resumeAuthorization(id,origin,wrong),{code:'invalid_proof'});
    assert.equal(f.store.get(id)!.lastUsedAt,1_000);
    await assert.rejects(f.core.resumeAuthorization(id,origin,proof(f,id,a.key)),{code:'authorized_host_unavailable'});
    assert.equal(f.store.get(id)!.lastUsedAt,1_000);assert.equal(f.store.list(f.now())[0].status,'active');
    f.start();const restored=await f.core.resumeAuthorization(id,origin,proof(f,id,a.key));
    assert.equal(restored.authorization.lastUsedAt,5_000);assert.equal((await f.core.session(restored.session.token,origin)).authorizationId,id);
    f.changeHost();await assert.rejects(f.core.resumeAuthorization(id,origin,proof(f,id,a.key)),{code:'host_changed'});
  }finally{f.close();}
});
test('exact 90-day boundary, challenge timeout, rollback and active use never extend grants through failed requests',async()=>{
  const f=fixture();try{
    const a=await connect(f),id=a.authorization!.id,p=proof(f,id,a.key);
    f.setNow(1_000+CHALLENGE_TTL);await assert.rejects(f.core.resumeAuthorization(id,origin,p),{code:'challenge_expired'});
    f.setNow(2_000);await f.core.session(a.session!.token,origin);assert.equal(f.store.get(id)!.lastUsedAt,2_000);
    f.setNow(1_500);await f.core.session(a.session!.token,origin);assert.equal(f.store.get(id)!.lastUsedAt,2_000);
    f.setNow(2_000+AUTHORIZATION_IDLE_TTL);assert.throws(()=>proof(f,id,a.key),{code:'authorization_expired'});
    assert.equal(f.store.get(id)!.lastUsedAt,2_000);
  }finally{f.close();}
});
test('wrong origin, Connector identity, purpose, malformed signature and replay cannot resume',async()=>{
  const f=fixture();try{
    const a=await connect(f),id=a.authorization!.id;
    assert.throws(()=>f.core.authorizationChallenge(id,'https://other.example',{version:'1.0',connectorId:f.store.connectorId,purpose:'resume'}),{code:'authorization_unknown'});
    assert.throws(()=>f.core.authorizationChallenge(id,origin,{version:'1.0',connectorId:'different-installation',purpose:'resume'}),{code:'connector_changed'});
    const wrongPurpose=proof(f,id,a.key,'revoke');await assert.rejects(f.core.resumeAuthorization(id,origin,wrongPurpose),{code:'invalid_proof'});
    const malformed=proof(f,id,a.key);await assert.rejects(f.core.resumeAuthorization(id,origin,{...malformed,signature:'A'.repeat(85)}),{code:'invalid_proof'});
    await assert.rejects(f.core.resumeAuthorization(id,origin,malformed),{code:'challenge_expired'});
    const p=proof(f,id,a.key);await f.core.resumeAuthorization(id,origin,p);await assert.rejects(f.core.resumeAuthorization(id,origin,p),{code:'challenge_expired'});
  }finally{f.close();}
});
test('concurrent use of one challenge has one winner; independent challenges allow separate tabs',async()=>{
  const f=fixture();try{
    const a=await connect(f),id=a.authorization!.id,p=proof(f,id,a.key);f.pause();
    const first=f.core.resumeAuthorization(id,origin,p),second=f.core.resumeAuthorization(id,origin,p);
    const secondChecked=assert.rejects(second,{code:'challenge_expired'});f.release();await Promise.all([first,secondChecked]);
    const results=await Promise.all([f.core.resumeAuthorization(id,origin,proof(f,id,a.key)),f.core.resumeAuthorization(id,origin,proof(f,id,a.key))]);
    assert.notEqual(results[0].session.id,results[1].session.id);
  }finally{f.close();}
});
test('revocation during pending host authentication wins and kills every existing session/challenge',async()=>{
  const f=fixture();try{
    const a=await connect(f),id=a.authorization!.id,other=await f.core.resumeAuthorization(id,origin,proof(f,id,a.key));
    const pendingProof=proof(f,id,a.key),unused=proof(f,id,a.key);f.pause();
    const pending=f.core.resumeAuthorization(id,origin,pendingProof),pendingSession=f.core.session(other.session.token,origin);f.core.revokeAuthorization(id);f.release();
    await assert.rejects(pending,{code:'authorization_revoked'});
    await assert.rejects(pendingSession,{code:'unauthorized'});
    await assert.rejects(f.core.session(a.session!.token,origin),{code:'unauthorized'});
    await assert.rejects(f.core.session(other.session.token,origin),{code:'unauthorized'});
    await assert.rejects(f.core.resumeAuthorization(id,origin,unused),{code:'authorization_revoked'});
    assert.equal(f.store.get(id)!.revokedAt,1_000);
  }finally{f.close();}
});
test('expiry while host authentication yields wins over a previously valid proof',async()=>{
  const f=fixture();try{
    const a=await connect(f),id=a.authorization!.id,p=proof(f,id,a.key);f.pause();
    const pending=f.core.resumeAuthorization(id,origin,p);f.setNow(1_000+AUTHORIZATION_IDLE_TTL);f.release();
    await assert.rejects(pending,{code:'authorization_expired'});assert.equal(f.store.get(id)!.lastUsedAt,1_000);
  }finally{f.close();}
});
test('disconnect keeps grant and other tabs; authenticated forget works with host offline and is durable',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'aipoch-forget-')),path=join(dir,'authorizations.sqlite');let f=fixture(path);
  try{
    const a=await connect(f),id=a.authorization!.id,other=await f.core.resumeAuthorization(id,origin,proof(f,id,a.key));
    await f.core.disconnect(a.session!.token,origin);await f.core.session(other.session.token,origin);
    assert.equal(f.store.list(f.now())[0].status,'active');f.stop();
    assert.deepEqual(f.core.revokeAuthorizationProof(id,origin,proof(f,id,a.key,'revoke')),{revoked:true});
    f.close();f=fixture(path);assert.equal(f.store.list(f.now())[0].status,'revoked');
    assert.throws(()=>proof(f,id,a.key),{code:'authorization_revoked'});
  }finally{f.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP confirmation defaults remember on; one-session choice and owner management are origin protected',async()=>{
  const f=fixture();f.setNow(Date.now());const server=createBridge(f.core,{adminToken:'test-owner',origins:[origin]});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const admin=async(path:string,input?:unknown)=>{const result=await fetch(base+path,{method:input?'POST':'GET',headers:{Authorization:'Bearer test-owner',...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined});assert.equal(result.status,200);return result.json() as Promise<any>;};
  try{
    const capabilities=await(await fetch(base+'/v1/capabilities',{headers:{Origin:origin}})).json() as any;
    assert.equal(capabilities.persistentAuthorization.connectorId,f.store.connectorId);
    const a=await f.core.pair(origin,'remember',key('<Firefox>').browser),review=await admin(`/admin/pairings/${a.pairingId}/review`,{});
    const page=await(await fetch(review.url)).text();assert.match(page,/name="remember" value="true" checked/);assert.match(page,/&lt;Firefox&gt;/);assert.match(page,/Browser credential fingerprint/);
    assert.equal((await fetch(review.url,{method:'POST',headers:{Origin:origin},body:'decision=approve&remember=true'})).status,403);
    assert.equal((await fetch(review.url,{method:'POST',headers:{Origin:base},body:'decision=approve&remember=true'})).status,200);
    const result=await f.core.pollPairing(a.pairingId,a.pollToken,origin);assert.ok(result.authorization);
    const b=await f.core.pair(origin,'session-only',key().browser),reviewB=await admin(`/admin/pairings/${b.pairingId}/review`,{});
    await fetch(reviewB.url,{method:'POST',headers:{Origin:base},body:'decision=approve'});
    assert.equal((await f.core.pollPairing(b.pairingId,b.pollToken,origin)).authorization,undefined);
    const management=await admin('/admin/authorizations/manage',{}),managementHtml=await(await fetch(management.url)).text();
    assert.match(managementHtml,/Remembered browsers/);assert.match(managementHtml,/Forget authorization/);assert.match(managementHtml,/Last used:/);
    assert.equal((await fetch(base+'/admin/authorizations',{headers:{Origin:origin,Authorization:'Bearer test-owner'}})).status,401);
    const form=`decision=revoke&authorizationId=${result.authorization!.id}`;
    assert.equal((await fetch(management.url,{method:'POST',headers:{Origin:origin},body:form})).status,403);
    assert.equal((await fetch(management.url,{method:'POST',headers:{Origin:base,Accept:'application/json'},body:form})).status,200);
    assert.equal(f.store.list(f.now())[0].status,'revoked');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));f.close();}
});

test('Web Crypto proof interoperates through versioned HTTP transport without public key or session leakage',async()=>{
  const {webcrypto}=await import('node:crypto');
  const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  assert.equal(keys.privateKey.extractable,false);
  const jwk=await webcrypto.subtle.exportKey('jwk',keys.publicKey);
  const f=fixture();f.setNow(Date.now());const server=createBridge(f.core,{adminToken:'test-owner',origins:[origin]});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const call=async(path:string,input?:unknown)=>{const response=await fetch(base+path,{method:input?'POST':'GET',headers:{Origin:origin,...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined});return {status:response.status,body:await response.json() as any};};
  try{
    const paired=await call('/v1/pairings',{protocolVersion:'1.0',attemptId:'webcrypto',browserAuthorization:{version:'1.0',publicKey:{kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y},browserName:'Synthetic Web Crypto'}});
    assert.equal(paired.status,200);await f.core.approvePairing(paired.body.pairingId,paired.body.verificationCode,origin,true);
    const approval=await f.core.pollPairing(paired.body.pairingId,paired.body.pollToken,origin),id=approval.authorization!.id;
    const challenge=await call(`/v1/authorizations/${id}/challenge`,{version:'1.0',connectorId:f.store.connectorId,purpose:'resume'});
    assert.equal(challenge.status,200);const fields=JSON.parse(challenge.body.challenge);
    assert.deepEqual(fields.slice(0,7),['aipoch-browser-authorization','1.0',f.store.connectorId,origin,id,'resume',challenge.body.challengeId]);
    assert.equal(fields[8],challenge.body.expiresAt);assert.equal(fields[7].length,43);
    const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,new TextEncoder().encode(challenge.body.challenge));
    assert.equal(signature.byteLength,64);
    const result=await call(`/v1/authorizations/${id}/resume`,{version:'1.0',connectorId:f.store.connectorId,challengeId:challenge.body.challengeId,signature:Buffer.from(signature).toString('base64url')});
    assert.equal(result.status,200);assert.equal(result.body.authorization.id,id);assert.notEqual(result.body.session.id,approval.session!.id);
    const checked=await fetch(base+'/v1/session',{headers:{Origin:origin,Authorization:`Bearer ${result.body.session.token}`}});
    assert.equal(checked.status,200);const session=await checked.json() as any;assert.equal(session.authorizationId,id);assert.equal(session.token,undefined);
    assert.equal(JSON.stringify(result.body.authorization).includes('publicKey'),false);
    const revokeChallenge=await call(`/v1/authorizations/${id}/challenge`,{version:'1.0',connectorId:f.store.connectorId,purpose:'revoke'});
    const revokeSignature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,new TextEncoder().encode(revokeChallenge.body.challenge));
    assert.deepEqual((await call(`/v1/authorizations/${id}/revoke`,{version:'1.0',connectorId:f.store.connectorId,challengeId:revokeChallenge.body.challengeId,signature:Buffer.from(revokeSignature).toString('base64url')})).body,{revoked:true});
    assert.equal((await fetch(base+'/v1/session',{headers:{Origin:origin,Authorization:`Bearer ${result.body.session.token}`}})).status,401);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));f.close();}
});

test('new Connector data directory cannot inherit an old identity and grant',async()=>{
  const first=fixture(),second=fixture();try{
    const a=await connect(first);assert.notEqual(first.store.connectorId,second.store.connectorId);
    assert.throws(()=>second.core.authorizationChallenge(a.authorization!.id,origin,{version:'1.0',connectorId:first.store.connectorId,purpose:'resume'}),{code:'connector_changed'});
    assert.throws(()=>second.core.authorizationChallenge(a.authorization!.id,origin,{version:'1.0',connectorId:second.store.connectorId,purpose:'resume'}),{code:'authorization_unknown'});
  }finally{first.close();second.close();}
});

test('MCP management opens only the private owner page without leaking tickets or revoking grants',async()=>{
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
  const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
  const {createMcpServer}=await import('../src/mcp.js');
  const calls:string[]=[],opened:string[]=[],privateUrl='http://127.0.0.1:47821/local/authorizations?ticket=synthetic-private-ticket';
  const server=createMcpServer('/synthetic',{request:async(_dir,path)=>{calls.push(path);return {url:privateUrl,expiresAt:1234};},openConfirmation:url=>{opened.push(url);}});
  const client=new Client({name:'authorization-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  try{
    await server.connect(b);await client.connect(a);
    const tools=(await client.listTools()).tools;assert.ok(tools.some(row=>row.name==='manage_browser_authorizations'));
    const result=await client.callTool({name:'manage_browser_authorizations',arguments:{}});
    assert.equal(result.isError,undefined);assert.deepEqual(calls,['/admin/authorizations/manage']);assert.deepEqual(opened,[privateUrl]);
    assert.equal(JSON.stringify(result).includes('synthetic-private-ticket'),false);assert.equal(JSON.stringify(result).includes('local/authorizations'),false);
  }finally{await client.close();await server.close();}
});

test('public independent P-256 vector verifies exact challenge bytes and rejects modified bindings',async()=>{
  const {createPublicKey,verify}=await import('node:crypto');
  const vector=JSON.parse(readFileSync(new URL('../docs/fixtures/persistent-authorization-v1.json',import.meta.url),'utf8'));
  const options={key:createPublicKey({key:vector.publicKey,format:'jwk'}),dsaEncoding:'ieee-p1363' as const};
  assert.equal(verify('sha256',Buffer.from(vector.challenge),options,Buffer.from(vector.signature,'base64url')),true);
  assert.equal(verify('sha256',Buffer.from(vector.challenge.replace('resume','revoke')),options,Buffer.from(vector.signature,'base64url')),false);
  assert.equal(vector.publicKey.d,undefined);
});

test('failed reference or missing receipt does not refresh last-use despite a valid session bearer',async()=>{
  const f=fixture();try{
    const a=await connect(f),id=a.authorization!.id;f.setNow(5_000);
    await assert.rejects(f.core.receive({},a.session!.token,origin),{code:'invalid_reference'});
    await assert.rejects(f.core.receipt('not-received',a.session!.token,origin),{code:'receipt_missing'});
    assert.equal(f.store.get(id)!.lastUsedAt,1_000);
    await f.core.session(a.session!.token,origin);assert.equal(f.store.get(id)!.lastUsedAt,5_000);
  }finally{f.close();}
});
