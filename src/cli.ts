#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminRequest, configuration, defaultDataDir, ensureRuntime, saveConfiguration, serve } from './runtime.js';
import { OpenScienceHost } from './workbench/index.js';
import { startMcp, openLocalConfirmation } from './mcp.js';

const args=process.argv.slice(2);
function option(name:string):string|undefined {
  const index=args.indexOf(`--${name}`); if(index<0)return;
  const value=args[index+1]; if(!value || value.startsWith('--'))throw new Error(`--${name} needs a value.`);
  args.splice(index,2);return value;
}
const dataDir=resolve(option('data-dir') ?? defaultDataDir());
const output=(value:unknown)=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function main() {
  const command=args.shift() ?? 'help';
  if(command==='help'||command==='--help') {
    process.stdout.write(`AIPOCH Connector\n\nsetup [--config-root PATH] [--origin URL] [--loopback-http allow|deny] [--port NUMBER] [--catalog-url MANIFEST_URL] [--github-client-id CLIENT_ID]\nserve | status | stop | mcp\npair list | pair review ID | pair approve ID --code CODE --origin URL | pair deny ID\nauthorizations list | authorizations manage | authorizations revoke ID\ninbox list | inbox show REQUEST_ID\noperations list | operations show OPERATION_ID\nprojects list | projects create NAME --operation-id ID --host-id ID\nassociate REQUEST_ID PROJECT_ID --host-id ID\nsearch QUERY | inspect OBJECT_ID\ngithub auth status | start | cancel | logout\ngithub resolve URL [--ref REF] [--path PATH]\ngithub preview URL --ref COMMIT --path PATH\ngithub acquire URL --ref COMMIT --path PATH --sha256 DIGEST --destination NEW_DIRECTORY --operation-id ID\n\nAll commands accept --data-dir PATH. Setup registers tools in a running Open-Science instance.\nNo command starts Open-Science or executes research.\n`); return;
  }
  if(command==='setup') {
    const config=await configuration(dataDir);const root=option('config-root'),origin=option('origin'),port=option('port'),catalogUrl=option('catalog-url'),githubClientId=option('github-client-id'),loopbackHttp=option('loopback-http');
    if(loopbackHttp!==undefined){
      if(!['allow','deny'].includes(loopbackHttp))throw new Error('Use --loopback-http allow or deny.');
      config.allowLoopbackHttp=loopbackHttp==='allow';
    }
    if(root)config.openScienceConfigRoot=resolve(root);
    if(origin && !config.origins.includes(origin))config.origins.push(origin);
    if(port)config.port=Number(port);
    if(catalogUrl)config.catalogManifestUrl=catalogUrl;
    if(githubClientId){if(!/^[A-Za-z0-9_.-]{4,200}$/.test(githubClientId))throw new Error('Invalid GitHub App client ID.');config.githubClientId=githubClientId;}
    // Validate before storing; registration uses the public SDK and never edits host settings files.
    if(!Number.isInteger(config.port)||config.port<1024||config.port>65535)throw new Error('Invalid Connector port.');
    if(origin) {const u=new URL(origin);if(u.origin!==origin || (u.protocol!=='https:' && !(u.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))))throw new Error('Use an exact HTTPS origin or explicit loopback development origin.');}
    await saveConfiguration(dataDir,config);
    const host=new OpenScienceHost({configRoot:config.openScienceConfigRoot});
    const registration=await host.registerMcp({command:process.execPath,args:[fileURLToPath(import.meta.url),'mcp','--data-dir',dataDir]});
    const runtime=await ensureRuntime(dataDir);output({configured:true,registration,...runtime,message:runtime.action==='restarted'
      ? 'Connector restarted and the saved configuration is active. Remembered browsers may recover a fresh session; other websites must pair again. Use a new Open-Science session if its tool list is already loaded.'
      : 'Saved configuration is active. Use a new Open-Science session if its current tool list is already loaded.'});return;
  }
  if(command==='serve'){await serve(dataDir);process.stderr.write('AIPOCH Connector is listening locally. Use status or pair list for details.\n');return;}
  if(command==='mcp'){await startMcp(dataDir);return;}
  if(command==='status') {
    try { output({...await adminRequest(dataDir,'/admin/status'),runtime:await adminRequest(dataDir,'/admin/runtime')}); }
    catch(error:any) {
      if(error.code!=='ENOENT' && error.code!=='ECONNREFUSED' && error.cause?.code!=='ECONNREFUSED')throw error;
      output({running:false,message:'Connector is not running. Run serve or setup.'});process.exitCode=1;
    }
    return;
  }
  if(command==='stop'){output(await adminRequest(dataDir,'/admin/shutdown','POST',{}));return;}
  await ensureRuntime(dataDir);
  if(command==='pair') {
    const action=args.shift(),id=args.shift();
    if(action==='list'){output(await adminRequest(dataDir,'/admin/pairings'));return;}
    if(!id)throw new Error('Specify the exact pairing ID.');
    if(action==='review'){const result=await adminRequest(dataDir,`/admin/pairings/${encodeURIComponent(id)}/review`,'POST',{});openLocalConfirmation(result.url);output({origin:result.origin,verificationCode:result.verificationCode,status:'waiting_for_user'});return;}
    if(action==='approve'){const code=option('code'),origin=option('origin'),remember=option('remember');if(remember!==undefined&&!['yes','no'].includes(remember))throw new Error('Use --remember yes or no.');if(!code||!origin)throw new Error('Compare the code and website before supplying --code and --origin.');output(await adminRequest(dataDir,`/admin/pairings/${encodeURIComponent(id)}/approve`,'POST',{code,origin,remember:remember==='yes'}));return;}
    if(action==='deny'){output(await adminRequest(dataDir,`/admin/pairings/${encodeURIComponent(id)}/deny`,'POST',{}));return;}
  }
  if(command==='authorizations') {
    const action=args.shift(),id=args.shift();
    if(action==='list'){output(await adminRequest(dataDir,'/admin/authorizations'));return;}
    if(action==='manage'){const result=await adminRequest(dataDir,'/admin/authorizations/manage','POST',{});openLocalConfirmation(result.url);output({status:'management_opened',expiresAt:result.expiresAt});return;}
    if(action==='revoke'&&id&&/^[a-f0-9-]{36}$/.test(id)){output(await adminRequest(dataDir,`/admin/authorizations/${id}/revoke`,'POST',{}));return;}
    throw new Error('Use authorizations list, authorizations manage or authorizations revoke ID.');
  }
  if(command==='operations') {
    const action=args.shift(),id=args.shift();
    if(action==='list'){output(await adminRequest(dataDir,'/admin/operations'));return;}
    if(action==='show'&&id&&/^[\w.-]{1,100}$/.test(id)){output(await adminRequest(dataDir,`/admin/operations/${encodeURIComponent(id)}`));return;}
    throw new Error('Use operations list or operations show OPERATION_ID.');
  }
  if(command==='inbox'){const action=args.shift();if(action==='list'){output(await adminRequest(dataDir,'/admin/inbox'));return;}if(action==='show'&&args[0]){output(await adminRequest(dataDir,`/admin/inbox/${encodeURIComponent(args[0])}`));return;}}
  if(command==='projects') {
    const action=args.shift();
    if(action==='list'){output(await adminRequest(dataDir,'/admin/projects'));return;}
    if(action==='create'){const operationId=option('operation-id'),expectedHostId=option('host-id');if(!operationId||!expectedHostId||!args[0])throw new Error('Provide name, --operation-id and --host-id from projects list.');output(await adminRequest(dataDir,'/admin/projects','POST',{name:args[0],operationId,expectedHostId}));return;}
  }
  if(command==='associate'){const expectedHostId=option('host-id');if(!expectedHostId||!args[0]||!args[1])throw new Error('Provide request ID, project ID and --host-id.');output(await adminRequest(dataDir,'/admin/associations','POST',{requestId:args[0],projectId:args[1],expectedHostId}));return;}
  if(command==='search'){output(await adminRequest(dataDir,'/admin/catalog/search','POST',{query:args.join(' ')}));return;}
  if(command==='inspect'){output(await adminRequest(dataDir,'/admin/catalog/get','POST',{id:args[0]}));return;}
  if(command==='github') {
    if(args[0]==='auth'){
      args.shift();const action=args.shift();
      if(!['status','start','cancel','logout'].includes(action??''))throw new Error('Use github auth status, start, cancel or logout.');
      output(await adminRequest(dataDir,`/admin/github/auth/${action}`,action==='status'?'GET':'POST',action==='status'?undefined:{}));return;
    }
    const action=args.shift(),url=args.shift(),ref=option('ref'),path=option('path'),expectedSha256=option('sha256'),destination=option('destination'),operationId=option('operation-id');
    if(!url)throw new Error('Provide a GitHub URL.');
    const source=await adminRequest(dataDir,'/admin/github/resolve','POST',{url,ref,path});
    if(action==='resolve'){output(source);return;}
    if(action==='preview'){output(await adminRequest(dataDir,'/admin/github/preview','POST',{source}));return;}
    if(action==='acquire'){if(!ref||!/^[a-f0-9]{40}$/.test(ref)||!expectedSha256||!destination||!operationId||!/^[\w.-]{1,100}$/.test(operationId))throw new Error('Review the full commit, file digest and new destination, and provide --operation-id for recovery before acquiring.');output(await adminRequest(dataDir,'/admin/github/materialize','POST',{source,expectedSha256,destination:resolve(destination),operationId}));return;}
  }
  throw new Error('Unknown or incomplete command. Run aipoch-connector help.');
}
main().catch((error:any)=>{process.stderr.write(JSON.stringify({error:{code:error.code??'operation_failed',message:error.message??'Operation failed.'}})+'\n');process.exitCode=1;});
