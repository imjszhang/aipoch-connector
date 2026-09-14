import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquisitionIdentity } from '../src/acquisition.js';
import { Inbox } from '../src/inbox.js';
import { digest } from '../src/contracts.js';
const input={operationId:'file-1',source:{sourceId:'source:github:123',repositoryId:123,owner:'example',repo:'research',canonicalUrl:'https://github.com/example/research',commit:'a'.repeat(40),ref:'a'.repeat(40),path:'LICENSE',resolvedAt:'first',license:{status:'unknown'},repositoryLicenseObservation:{spdxId:'MIT',observedAt:'first',basis:'current_repository_metadata'},conditions:['Keep notices']},expectedSha256:'b'.repeat(64),destination:'/synthetic/new'};
const evidence=(value:any)=>({identityVersion:'acquire-v1',input:value,legacyHash:digest(JSON.stringify(value))});
test('stable identity retains all source conditions and ignores only observation times and key ordering',()=>{
 const inbox=new Inbox(':memory:');const hash=acquisitionIdentity(input).hash;
 try {
 inbox.beginOperation(input.operationId,hash,evidence(input));inbox.finishOperation(input.operationId,{status:'files_acquired'});
 const replay=structuredClone(input);replay.source.resolvedAt='later';replay.source.repositoryLicenseObservation.observedAt='later';
 assert.equal(acquisitionIdentity({...replay,source:Object.fromEntries(Object.entries(replay.source).reverse())}).hash,hash);
 assert.equal(acquisitionIdentity({...replay,destination:'/synthetic/child/../new'}).hash,hash);
 assert.equal(inbox.beginOperation(input.operationId,acquisitionIdentity(replay).hash,evidence(replay)).state,'complete');
 assert.deepEqual(inbox.getOperation(input.operationId)?.input,input);
 for(const patch of [{destination:'/synthetic/other'},{expectedSha256:'c'.repeat(64)},...[
 {commit:'c'.repeat(40)},{path:'README.md'},{ref:'other'},{repositoryId:124,sourceId:'source:github:124'},
 {license:{status:'known',spdxId:'Apache-2.0'}},{conditions:['Different conditions']},{repositoryLicenseObservation:{...input.source.repositoryLicenseObservation,spdxId:'Apache-2.0'}},
 {owner:'other',canonicalUrl:'https://github.com/other/research'}
 ].map(source=>({source:{...input.source,...source}}))]) {
 const changed={...input,...patch};assert.throws(()=>inbox.beginOperation(input.operationId,acquisitionIdentity(changed).hash,evidence(changed)),{code:'operation_conflict'});
 }
 }finally{inbox.close();}
});
test('schema 1 upgrade preserves receipts, associations and legacy complete/pending results without guessing identities',()=>{
 const dir=mkdtempSync(join(tmpdir(),'aipoch-schema-'));const path=join(dir,'inbox.sqlite');
 const db=new DatabaseSync(path);
 db.exec(`CREATE TABLE receipts(request_id TEXT PRIMARY KEY,session_id TEXT,object_id TEXT,content_hash TEXT,submission TEXT,host_id TEXT,title TEXT,received_at INTEGER);
 CREATE TABLE associations(request_id TEXT,host_id TEXT,project_id TEXT,project_name TEXT,linked_at INTEGER,PRIMARY KEY(request_id,host_id,project_id));
 CREATE TABLE operations(operation_id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,state TEXT NOT NULL,result TEXT); PRAGMA user_version=1;`);
 const submission={requestId:'r',review:{content:'exact original text'}};
 db.prepare('INSERT INTO receipts VALUES (?,?,?,?,?,?,?,?)').run('r','s','o','hash',JSON.stringify(submission),'h','title',1);
 db.prepare('INSERT INTO associations VALUES (?,?,?,?,?)').run('r','h','p','project',2);
 db.prepare('INSERT INTO operations VALUES (?,?,?,?)').run('file-1',digest(JSON.stringify(input)),'complete',JSON.stringify({status:'files_acquired',file:'/synthetic/new/LICENSE'}));
 db.prepare('INSERT INTO operations VALUES (?,?,?,NULL)').run('pending',digest(JSON.stringify({...input,operationId:'pending'})),'pending');db.close();
 let inbox=new Inbox(path);
 try {
 assert.deepEqual(inbox.get('r')?.submission,submission);assert.equal(inbox.links('p','h').length,1);
 const before=inbox.getOperation('file-1');
 assert.equal(inbox.beginOperation('file-1',acquisitionIdentity(input).hash,evidence(input)).state,'complete');
 const changed={...input,source:{...input.source,resolvedAt:'later'}};
 assert.throws(()=>inbox.beginOperation('file-1',acquisitionIdentity(changed).hash,evidence(changed)),{code:'legacy_operation_unverifiable'});
 assert.equal(inbox.getOperation('pending')?.outcome,'unknown');assert.deepEqual(inbox.getOperation('file-1'),before);
 inbox.close();inbox=new Inbox(path);assert.deepEqual(inbox.getOperation('file-1'),before);assert.deepEqual(inbox.get('r')?.submission,submission);assert.equal(inbox.links('p','h').length,1);
 }finally{inbox.close();rmSync(dir,{recursive:true,force:true});}
});
test('unknown database versions are rejected without resetting durable evidence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'aipoch-future-schema-'));const path=join(dir,'inbox.sqlite');
 try {
 const db=new DatabaseSync(path);db.exec("CREATE TABLE evidence(value TEXT); INSERT INTO evidence VALUES ('retained'); PRAGMA user_version=3;");db.close();
 assert.throws(()=>new Inbox(path),/newer Connector/);
 const read=new DatabaseSync(path);assert.equal((read.prepare('SELECT value FROM evidence').get() as any).value,'retained');assert.equal((read.prepare('PRAGMA user_version').get() as any).user_version,3);read.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
