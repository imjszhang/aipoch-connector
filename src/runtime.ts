import { effectiveAllowLoopbackHttp } from './origin-policy.js';
import { packageManifest, packageVersion } from './version.js';
import { acquisitionIdentity } from './acquisition.js';
import { mkdir, readFile, writeFile, open, unlink, lstat, realpath, readdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AuthorizationStore } from './authorizations.js';
import { Inbox } from './inbox.js';
import { ConnectorCore } from './core.js';
import { createBridge } from './bridge.js';
import { ConnectorError, DEFAULT_PORT, digest } from './contracts.js';
import { OpenScienceHost } from './workbench/index.js';
import { CatalogClient } from './catalog/index.js';
import { createCatalogReviewGuard } from './catalog/review-validation.js';
import { GithubClient } from './github/index.js';
import { GithubAuth } from './github-auth.js';
import { CredentialStore } from './credentials.js';

// Public application identity; authorization still requires each user's consent.
export const DEFAULT_GITHUB_CLIENT_ID = 'Iv23liAWWYs4LOqm1YAg';

export interface Configuration { version: 1; port: number; origins: string[]; allowLoopbackHttp?: boolean; openScienceConfigRoot?: string; githubClientId?: string; catalogManifestUrl?: string }
export const defaultDataDir = () => join(homedir(),process.platform==='darwin'?'Library/Application Support/AIPOCH Connector':'.local/share/aipoch-connector');
export async function ownerDirectory(dir: string) {
  await mkdir(dir,{recursive:true,mode:0o700});
  const info=await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink() || (typeof process.getuid==='function' && info.uid!==process.getuid()) || (info.mode & 0o077))
    throw new Error('Connector data directory must be owned by you and accessible only to you.');
}
export async function configuration(dir: string): Promise<Configuration> {
  await ownerDirectory(dir);
  let value: Configuration;
  try { value=JSON.parse(await readFile(join(dir,'config.json'),'utf8')); }
  catch (e:any) { if(e.code!=='ENOENT') throw new Error('Connector configuration is invalid; the existing file was preserved.'); return {version:1,port:DEFAULT_PORT,origins:['https://aipoch.network'],allowLoopbackHttp:true,githubClientId:DEFAULT_GITHUB_CLIENT_ID}; }
  if(value.version!==1 || !Number.isInteger(value.port) || value.port<1024 || value.port>65535 || !Array.isArray(value.origins)) throw new Error('Unsupported Connector configuration.');
  for(const origin of value.origins) {
    const u=new URL(origin);
    if(u.origin!==origin || (u.protocol!=='https:' && !(u.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname)))) throw new Error('Origins must be exact HTTPS origins or explicitly configured loopback development origins.');
  }
  return {...value, allowLoopbackHttp: effectiveAllowLoopbackHttp(value.allowLoopbackHttp), githubClientId: value.githubClientId ?? DEFAULT_GITHUB_CLIENT_ID};
}
export async function saveConfiguration(dir:string,config:Configuration) {
  const value = {...config, allowLoopbackHttp: effectiveAllowLoopbackHttp(config.allowLoopbackHttp)};
  await ownerDirectory(dir);
  const temporary=join(dir,`config-${randomUUID()}.tmp`);
  try { await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'}); await rename(temporary,join(dir,'config.json')); }
  finally { await unlink(temporary).catch(()=>{}); }
}
export interface RuntimeIdentity {
  identityVersion: 1; runtimeId: string; pid: number; dataDirectoryId: string;
  configSha256: string; packageVersion: string; codeSha256: string; nodeVersion: string;
}
interface RuntimeRecord { pid: number; url: string; token: string; identity?: RuntimeIdentity }
export interface RuntimeResult { action: 'started' | 'restarted' | 'unchanged'; configurationApplied: true; runtime: RuntimeIdentity }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const dataDirectoryId = async (dir: string) => digest(await realpath(dir));
export function configurationDigest(config: Configuration): string {
  return digest(JSON.stringify({ version: config.version, port: config.port,
    origins: [...new Set(config.origins)].sort(), allowLoopbackHttp: effectiveAllowLoopbackHttp(config.allowLoopbackHttp),
    openScienceConfigRoot: config.openScienceConfigRoot ? resolve(config.openScienceConfigRoot) : null,
    githubClientId: config.githubClientId ?? DEFAULT_GITHUB_CLIENT_ID, catalogManifestUrl: config.catalogManifestUrl ?? null }));
}
/** Compare actual runtime code too: local builds can change without a package-version bump. */
export async function runtimeVersion(): Promise<Pick<RuntimeIdentity, 'packageVersion' | 'codeSha256' | 'nodeVersion'>> {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const parts: string[] = [];
  async function collect(dir: string, prefix: string) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await collect(join(dir, entry.name), prefix + entry.name + '/');
      else if (entry.isFile() && /\.(?:[cm]?js|ts|json)$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
        parts.push(prefix + entry.name + ':' + digest(await readFile(join(dir, entry.name), 'utf8')));
    }
  }
  await collect(directory, 'runtime/');
  await collect(fileURLToPath(new URL('../vendor/', import.meta.url)), 'vendor/');
  const manifest = packageManifest;
  return { packageVersion, codeSha256: digest(manifest + '\n' + parts.join('\n')), nodeVersion: process.version };
}
export async function runtimeRecord(dir: string): Promise<RuntimeRecord> {
  const path = join(dir, 'runtime.json'), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || (typeof process.getuid === 'function' && info.uid !== process.getuid()))
    throw new Error('Runtime discovery is not owner-protected.');
  const record = JSON.parse(await readFile(path, 'utf8')); const url = new URL(record.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !Number.isSafeInteger(record.pid) || record.pid < 1 || typeof record.token !== 'string' || record.token.length < 32)
    throw new Error('Invalid local runtime discovery.');
  return record;
}
async function requestRuntime(record: RuntimeRecord, path: string, method = 'GET', body?: unknown, timeoutMs = 30_000) {
  const response = await fetch(record.url + path, { method, headers: { Authorization: `Bearer ${record.token}`,
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  const data = await response.json() as any;
  if (!response.ok) throw new ConnectorError(data.error?.code ?? 'request_failed', data.error?.message ?? 'Local Connector request failed.', response.status);
  return data;
}
export async function adminRequest(dir: string, path: string, method = 'GET', body?: unknown) {
  await ownerDirectory(dir);
  return requestRuntime(await runtimeRecord(dir), path, method, body);
}
function isAlive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error: any) { return error.code !== 'ESRCH'; }
}
async function matchingIdentity(dir: string, record: RuntimeRecord): Promise<RuntimeIdentity> {
  if (!record.identity || record.identity.dataDirectoryId !== await dataDirectoryId(dir))
    throw new ConnectorError('runtime_identity_unconfirmed', 'The running Connector cannot be identified as this data directory. Inspect it locally; explicitly stop your older core before setup.', 409);
  const current = await requestRuntime(record, '/admin/runtime', 'GET', undefined, 1_000) as RuntimeIdentity;
  if (current.identityVersion !== 1 || current.pid !== record.pid || current.runtimeId !== record.identity.runtimeId ||
      current.dataDirectoryId !== record.identity.dataDirectoryId || JSON.stringify(current) !== JSON.stringify(record.identity))
    throw new ConnectorError('runtime_identity_unconfirmed', 'Runtime identity changed or belongs to a different data directory. No runtime was stopped.', 409);
  return current;
}
/** Serialize discovery/restart for one owner directory. PID checks only probe, never terminate. */
async function ensureLock(dir: string): Promise<() => Promise<void>> {
  const path = join(dir, 'runtime.ensure.lock'), deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const file = await open(path, 'wx', 0o600); await file.writeFile(String(process.pid)); await file.close();
      return async () => { await unlink(path).catch(()=>{}); };
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || (typeof process.getuid === 'function' && info.uid !== process.getuid()))
          throw new ConnectorError('runtime_lock_invalid', 'Runtime coordination lock is not owner-protected.');
        const pid = Number(await readFile(path, 'utf8'));
        if (Number.isSafeInteger(pid) && pid > 0 && !isAlive(pid)) await unlink(path);
      } catch (problem: any) { if (problem.code !== 'ENOENT') throw problem; }
      await delay(100);
    }
  }
  throw new ConnectorError('runtime_busy', 'Another local setup is still applying configuration. Try again after it finishes.', 409);
}
export async function ensureRuntime(dir: string): Promise<RuntimeResult> {
  dir = resolve(dir); await ownerDirectory(dir);
  const release = await ensureLock(dir);
  let action: RuntimeResult['action'] = 'unchanged';
  try {
    const expectedVersion = await runtimeVersion();
    for (let attempt = 0; attempt < 3; attempt++) {
      const expectedDigest = configurationDigest(await configuration(dir));
      let record: RuntimeRecord | undefined;
      try { record = await runtimeRecord(dir); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      if (record && isAlive(record.pid)) {
        // Validate this exact token/instance once and use the same record for shutdown.
        const identity = await matchingIdentity(dir, record);
        if (configurationDigest(await configuration(dir)) !== expectedDigest) continue;
        if (identity.configSha256 === expectedDigest && identity.packageVersion === expectedVersion.packageVersion &&
            identity.codeSha256 === expectedVersion.codeSha256 && identity.nodeVersion === expectedVersion.nodeVersion)
          return { action, configurationApplied: true, runtime: identity };
        await requestRuntime(record, '/admin/shutdown', 'POST', {}, 1_000);
        const deadline = Date.now() + 10_000;
        while (isAlive(record.pid) && Date.now() < deadline) await delay(100);
        if (isAlive(record.pid)) throw new ConnectorError('runtime_stop_unconfirmed', 'The previous Connector has not stopped. No replacement was started.', 409);
        action = 'restarted';
      }
      const source = import.meta.url.endsWith('.ts');
      const cli = fileURLToPath(new URL(source ? './cli.ts' : './cli.js', import.meta.url));
      const child = spawn(process.execPath, [...(source ? ['--import', fileURLToPath(import.meta.resolve('tsx'))] : []), cli, 'serve', '--data-dir', dir],
        { detached: true, stdio: 'ignore', env: process.env });
      let failed = false; child.once('error', () => { failed = true; }); child.unref();
      if (action !== 'restarted') action = 'started';
      const deadline = Date.now() + 10_000;
      while (!failed && Date.now() < deadline) {
        await delay(100);
        try {
          const started = await runtimeRecord(dir);
          if (started.pid === child.pid) {
            const identity = await matchingIdentity(dir, started);
            if (identity.configSha256 === expectedDigest && identity.packageVersion === expectedVersion.packageVersion &&
                identity.codeSha256 === expectedVersion.codeSha256 && identity.nodeVersion === expectedVersion.nodeVersion &&
                configurationDigest(await configuration(dir)) === expectedDigest)
              return { action, configurationApplied: true, runtime: identity };
            break; // Configuration changed while starting; reconcile under the same lock.
          }
        } catch (error: any) { if (error.code === 'runtime_identity_unconfirmed') throw error; }
      }
      if (failed || Date.now() >= deadline) throw new ConnectorError('runtime_start_failed', 'Connector did not start. Run aipoch-connector serve to see local diagnostics.');
    }
    throw new ConnectorError('runtime_configuration_changed', 'Configuration changed repeatedly during setup. Wait for the other setup to finish and try again.', 409);
  } finally { await release(); }
}
export async function serve(dir:string) {
  dir=resolve(dir);
  const config=await configuration(dir);
  const identity: RuntimeIdentity={identityVersion:1,runtimeId:randomUUID(),pid:process.pid,
    dataDirectoryId:await dataDirectoryId(dir),configSha256:configurationDigest(config),...await runtimeVersion()};
  const lockPath=join(dir,'runtime.lock');
  let lock;
  try {lock=await open(lockPath,'wx',0o600);} catch(e:any) {
    if(e.code!=='EEXIST') throw e;
    const previous=Number(await readFile(lockPath,'utf8'));
    if(!Number.isSafeInteger(previous) || previous<1) throw new Error('Invalid runtime lock; inspect it locally before recovery.');
    let alive=true; try{process.kill(previous,0);}catch(error:any){if(error.code==='ESRCH')alive=false;}
    if(alive) throw new Error('A Connector runtime is already starting or running for this data directory.');
    await unlink(lockPath); lock=await open(lockPath,'wx',0o600);
  }
  await lock.writeFile(String(process.pid)); await lock.close();
  const token=randomBytes(32).toString('base64url'); const inbox=new Inbox(join(dir,'inbox.sqlite'));
  const host=new OpenScienceHost({configRoot:config.openScienceConfigRoot}); const catalog=new CatalogClient({manifestUrl:config.catalogManifestUrl});
  const authorizations=new AuthorizationStore(join(dir,'authorizations.sqlite'));
  const core=new ConnectorCore(inbox,host,()=>Date.now(),createCatalogReviewGuard(catalog),authorizations);
  const githubAuth=new GithubAuth(new CredentialStore(dir),config.githubClientId);
  const github=async()=>new GithubClient({token:process.env.AIPOCH_GITHUB_TOKEN ?? (process.platform==='darwin'?await githubAuth.token():undefined)});
  const acquire=async(input:any)=>{
    if(typeof input.operationId!=='string' || !/^[\w.-]{1,100}$/.test(input.operationId))throw new ConnectorError('operation_id_required','A file acquisition requires an explicit operation ID.');
    const identity=acquisitionIdentity(input);
    const existing=inbox.beginOperation(input.operationId,identity.hash,{identityVersion:'acquire-v1',input,legacyHash:digest(JSON.stringify(input))});
    if(existing.state==='complete')return existing.result;
    if(existing.state!=='new')throw new ConnectorError('result_unconfirmed','An earlier file acquisition may have completed. Inspect its exact destination before choosing another operation.',409);
    const result=await (await github()).materialize(input.source,identity.destination,{expectedSha256:input.expectedSha256});
    inbox.finishOperation(input.operationId,result);return result;
  };
  const bridge=createBridge(core,{adminToken:token,origins:config.origins,allowLoopbackHttp:config.allowLoopbackHttp,prepareAction:async(kind,input)=>{
    if(!input || typeof input!=='object')throw new ConnectorError('invalid_action','An exact action is required.');
    // Owner-page approval is bound to this captured plan. Later MCP arguments cannot change it.
    const plan=structuredClone(input);
    if(kind==='associate_reference'){
      const reference=inbox.get(plan.requestId);const status=await core.status();const project=(await host.listProjects()).find(row=>row.id===plan.projectId);
      if(!reference || !project || status.hostId!==plan.expectedHostId)throw new ConnectorError('invalid_target','Select the received reference and exact project again.');
      return{display:{action:'Associate received reference',reference:reference.title,requestId:plan.requestId,contentSha256:reference.receipt.contentSha256,project,hostId:plan.expectedHostId},execute:()=>core.associate(plan.requestId,plan.projectId,plan.expectedHostId)};
    }
    if(kind==='create_project'){
      if(typeof plan.name!=='string'||!plan.name.trim()||plan.name.length>200||typeof plan.operationId!=='string')throw new ConnectorError('invalid_project','Provide the exact project name and operation ID.');
      return{operationId:plan.operationId,display:{action:'Create research project',...plan},execute:()=>core.createProject(plan)};
    }
    if(kind==='acquire_github_file'){
      if(typeof plan.destination!=='string')throw new ConnectorError('invalid_destination','Choose a new directory.');
      plan.destination=resolve(plan.destination);plan.operationId=randomUUID();
      const preview=await (await github()).preview(plan.source);
      if(preview.sha256!==plan.expectedSha256)throw new ConnectorError('content_changed','Preview the file again before acquiring it.');
      return{operationId:plan.operationId,display:{action:'Acquire fixed-version file',source:plan.source,sha256:preview.sha256,size:preview.size,destination:plan.destination,operationId:plan.operationId},execute:()=>acquire(plan)};
    }
    throw new ConnectorError('unsupported_action','This local action is not supported.');
  },adminHandler:async(path,method,input)=>{
    try {
      if(path==='/admin/runtime' && method==='GET')return identity;
      if(path==='/admin/operations' && method==='GET')return inbox.listOperations();
      const operationPath=path.match(/^\/admin\/operations\/([\w.-]{1,100})$/);
      if(operationPath && method==='GET') {
        const operation=inbox.getOperation(operationPath[1]);
        if(!operation)throw new ConnectorError('operation_missing','No durable record exists for this operation ID.',404);
        return operation;
      }
      if(path==='/admin/catalog/search' && method==='POST')return catalog.search(input.query ?? '',{limit:input.limit,kind:input.kind});
      if(path==='/admin/catalog/get' && method==='POST')return (await catalog.get(input.id)) ?? null;
      if(path==='/admin/github/auth/status' && method==='GET')return githubAuth.status();
      if(path==='/admin/github/auth/start' && method==='POST')return githubAuth.start();
      if(path==='/admin/github/auth/cancel' && method==='POST')return githubAuth.cancel();
      if(path==='/admin/github/auth/logout' && method==='POST')return githubAuth.logout();
      if(path==='/admin/github/resolve' && method==='POST')return (await github()).resolve(input.url,{ref:input.ref,path:input.path});
      if(path==='/admin/github/list' && method==='POST')return (await github()).list(input.source);
      if(path==='/admin/github/preview' && method==='POST') {const result=await (await github()).preview(input.source);const {bytes,...rest}=result;return rest;}
      if(path==='/admin/github/materialize' && method==='POST')return await acquire(input);
      if(path==='/admin/shutdown' && method==='POST'){setTimeout(()=>process.kill(process.pid,'SIGTERM'),50);return{stopping:true};}
      throw new ConnectorError('not_found','This local operation does not exist.',404);
    }catch(error:any){if(error instanceof ConnectorError)throw error;if(['GithubError','CatalogError'].includes(error?.name))throw new ConnectorError(error.code,error.message,422);throw error;}
  }});
  try {
    await new Promise<void>((resolve,reject)=>{bridge.once('error',reject);bridge.listen(config.port,'127.0.0.1',resolve);});
    await writeFile(join(dir,'runtime.json'),JSON.stringify({pid:process.pid,url:`http://127.0.0.1:${config.port}`,token,identity}),{mode:0o600});
  }catch(error){bridge.close();inbox.close();authorizations.close();await unlink(lockPath).catch(()=>{});throw error;}
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await githubAuth.cancel();bridge.closeAllConnections();await new Promise<void>(resolve=>bridge.close(()=>resolve()));inbox.close();authorizations.close();await unlink(join(dir,'runtime.json')).catch(()=>{});await unlink(lockPath).catch(()=>{});};
  process.once('SIGTERM',()=>{void close().then(()=>process.exit(0));});process.once('SIGINT',()=>{void close().then(()=>process.exit(0));});
  return {core,bridge,close};
}
