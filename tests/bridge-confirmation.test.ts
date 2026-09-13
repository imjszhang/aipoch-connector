import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createBridge } from '../src/bridge.js';
import { ConnectorCore } from '../src/core.js';
import { Inbox } from '../src/inbox.js';

test('concurrent slow confirmation bodies consume a ticket only once',async()=>{
  const inbox=new Inbox(':memory:');let writes=0;
  const core=new ConnectorCore(inbox,{status:async()=>({ready:true,instanceId:'test'}),listProjects:async()=>[],createProject:async()=>({id:'test',name:'Test'})});
  const server=createBridge(core,{adminToken:'test-owner',origins:[],prepareAction:async()=>({display:{name:'Test only'},operationId:'durable-test-operation',execute:async()=>{writes++;await new Promise(resolve=>setTimeout(resolve,20));return{confirmed:true};}})});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  try{
    const prepared=await(await fetch(base+'/admin/actions',{method:'POST',headers:{Authorization:'Bearer test-owner','Content-Type':'application/json'},body:JSON.stringify({kind:'test',input:{}})})).json() as any;
    assert.equal(prepared.operationId,'durable-test-operation');
    const page=await fetch(prepared.url);const html=await page.text();
    const nonce=html.match(/<script nonce="([\w-]+)"/);assert.ok(nonce);
    assert.ok(page.headers.get('content-security-policy')?.includes(`script-src 'nonce-${nonce[1]}'`));
    assert.ok(page.headers.get('content-security-policy')?.includes("connect-src 'self'"));
    let arrivals=0;let bothArrived!:()=>void;
    const arrived=new Promise<void>(resolve=>{bothArrived=resolve;});
    server.on('request',req=>{if(req.method==='POST' && req.url?.startsWith('/local/confirm') && ++arrivals===2)bothArrived();});
    const slow=()=>{
      let finish!:()=>void;
      const response=new Promise<{status:number;body:any}>((resolve,reject)=>{
        const req=request(prepared.url,{method:'POST',headers:{Origin:base,Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'}},res=>{
          let body='';res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(body)}));
        });req.on('error',reject);req.write('decision=');finish=()=>req.end('approve');
      });return{response,finish};
    };
    const a=slow(),b=slow();await arrived;a.finish();b.finish();
    const results=await Promise.all([a.response,b.response]);
    assert.deepEqual(results.map(row=>row.status).sort(),[200,410]);assert.equal(writes,1);
    assert.equal(results.find(row=>row.status===200)?.body.title,'Action completed');
    assert.deepEqual(results.find(row=>row.status===200)?.body.result,{confirmed:true});
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));inbox.close();}
});
