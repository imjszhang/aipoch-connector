import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configuration,configurationDigest,saveConfiguration,type Configuration} from '../src/runtime.js';

test('loopback HTTP defaults apply to new and legacy configurations without rewriting explicit preferences',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aipoch-loopback-config-'));
 try {
  const fresh=await configuration(dir);assert.equal(fresh.allowLoopbackHttp,true);
  fresh.origins.push('https://example.test');
  assert.deepEqual((await configuration(dir)).origins,['https://aipoch.network']);
  const legacy:Configuration={version:1,port:47821,origins:['https://custom.example'],githubClientId:'custom-app',catalogManifestUrl:'https://custom.example/catalog/v1/manifest.json',openScienceConfigRoot:'/synthetic/profile'};
  await writeFile(join(dir,'config.json'),JSON.stringify(legacy));const bytes=await readFile(join(dir,'config.json'),'utf8');
  assert.deepEqual(await configuration(dir),{...legacy,allowLoopbackHttp:true});
  assert.equal(await readFile(join(dir,'config.json'),'utf8'),bytes);
  assert.equal(configurationDigest(legacy),configurationDigest({...legacy,allowLoopbackHttp:true}));
  assert.notEqual(configurationDigest(legacy),configurationDigest({...legacy,allowLoopbackHttp:false}));
  await saveConfiguration(dir,legacy);
  assert.equal(JSON.parse(await readFile(join(dir,'config.json'),'utf8')).allowLoopbackHttp,true);
  assert.equal(legacy.allowLoopbackHttp,undefined);
  await saveConfiguration(dir,{...legacy,allowLoopbackHttp:false});assert.equal((await configuration(dir)).allowLoopbackHttp,false);
  for(const bad of [null,'true','false',0,1,{},[]]) {
   const saved=await readFile(join(dir,'config.json'),'utf8');
   await assert.rejects(saveConfiguration(dir,{...legacy,allowLoopbackHttp:bad} as any),/allowLoopbackHttp/);
   assert.equal(await readFile(join(dir,'config.json'),'utf8'),saved);
   const invalid=JSON.stringify({...legacy,allowLoopbackHttp:bad});await writeFile(join(dir,'config.json'),invalid);
   await assert.rejects(configuration(dir),/allowLoopbackHttp/);assert.equal(await readFile(join(dir,'config.json'),'utf8'),invalid);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
