import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { ConnectorCore, equalSecret } from './core.js';
import { ConnectorError, MAX_BODY_BYTES, PROTOCOL_VERSION } from './contracts.js';

interface Options {
  adminToken: string; origins: string[];
  adminHandler?: (path: string, method: string, body: any) => Promise<unknown>;
  prepareAction?: (kind:string,input:any) => Promise<{display:unknown;operationId?:string;execute:()=>Promise<unknown>}>;
}
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
async function body(request: IncomingMessage, form = false): Promise<any> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY_BYTES + 4096) throw new ConnectorError('body_too_large','The request is too large.',413); chunks.push(chunk); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (form) return Object.fromEntries(new URLSearchParams(raw));
  if (!raw) return {};
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new ConnectorError('content_type','Use a JSON request.',415);
  try { return JSON.parse(raw); } catch { throw new ConnectorError('invalid_json','The request is not valid JSON.'); }
}
function send(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); response.end(JSON.stringify(value));
}
// Native forms remain a fallback; embedded browsers may block POST navigations.
function confirmationScript(response: ServerResponse) {
  const nonce=randomBytes(24).toString('base64url');
  response.setHeader('Content-Security-Policy',`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
  return `<script nonce="${nonce}">document.querySelector('form').addEventListener('submit',async function(event){event.preventDefault();const form=event.currentTarget;const data=new URLSearchParams(new FormData(form,event.submitter));const buttons=[...form.querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);try{const response=await fetch(form.action,{method:'POST',headers:{Accept:'application/json'},body:data});const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'The result could not be confirmed.');document.querySelector('h1').textContent=result.title;document.querySelectorAll('p,code,strong,pre').forEach(node=>node.remove());const message=document.createElement('p');message.textContent=result.message;form.before(message);if(result.result){const details=document.createElement('pre');details.textContent=JSON.stringify(result.result,null,2);form.before(details);}form.remove();}catch(error){const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=error.message+' Return to Open-Science to check the result before requesting another confirmation.';form.after(message);}});</script>`;
}
function confirmationResult(request: IncomingMessage,response: ServerResponse,title:string,message:string,result?:unknown) {
  if(request.headers.accept?.includes('application/json'))return send(response,{title,message,result});
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  response.end(`<!doctype html><html lang="en"><title>AIPOCH Connector</title><h1>${escape(title)}</h1><p>${escape(message)}</p>${result?`<pre>${escape(JSON.stringify(result,null,2))}</pre>`:''}</html>`);
}
export function createBridge(core: ConnectorCore, options: Options) {
  const tickets = new Map<string, {pairingId?: string; actionId?:string; expiresAt: number}>();
  const actions = new Map<string,{display:unknown;execute:()=>Promise<unknown>;state:'pending'|'running'|'complete'|'declined'|'failed';result?:unknown;expiresAt:number}>();
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control','no-store'); response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('X-Content-Type-Options','nosniff'); response.setHeader('X-Frame-Options','DENY');
    response.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const expectedHost = `127.0.0.1:${port}`;
      if (request.headers.host !== expectedHost) throw new ConnectorError('invalid_host','Only the local Connector address is accepted.',403);
      const url = new URL(request.url ?? '/', `http://${expectedHost}`), path = url.pathname;
      const origin = request.headers.origin ?? '';
      const auth = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
      if (path.startsWith('/v1/')) {
        if (!options.origins.includes(origin)) throw new ConnectorError('origin_denied','This website is not allowed to connect.',403);
        response.setHeader('Access-Control-Allow-Origin',origin); response.setHeader('Vary','Origin');
        response.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
        if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
        if (path === '/v1/pairings' && request.method === 'POST') {
          const input = await body(request);
          if (input.protocolVersion !== PROTOCOL_VERSION || typeof input.attemptId !== 'string' || !/^[\w.-]{1,200}$/.test(input.attemptId))
            throw new ConnectorError('unsupported_protocol','The connection protocol or attempt is not supported.');
          return send(response, await core.pair(origin, input.attemptId));
        }
        const pairing = path.match(/^\/v1\/pairings\/([a-f0-9-]{36})$/);
        if (pairing && request.method === 'GET') return send(response,await core.pollPairing(pairing[1],auth,origin));
        if (path === '/v1/session' && request.method === 'GET') {
          const session = await core.session(auth,origin);
          return send(response,{id:session.id,expiresAt:session.expiresAt,hostReady:true});
        }
        if (path === '/v1/session' && request.method === 'DELETE') return send(response,await core.disconnect(auth,origin));
        if (path === '/v1/references' && request.method === 'POST') return send(response,await core.receive(await body(request),auth,origin));
        const receipt = path.match(/^\/v1\/receipts\/([\w:.-]{1,200})$/);
        if (receipt && request.method === 'GET') return send(response,await core.receipt(receipt[1],auth,origin));
      } else if (path.startsWith('/admin/')) {
        if (origin || !equalSecret(auth,options.adminToken)) throw new ConnectorError('unauthorized','Local administration requires owner authentication.',401);
        if (path === '/admin/status' && request.method === 'GET') return send(response,{protocolVersion:PROTOCOL_VERSION,host:await core.status()});
        if(path==='/admin/actions' && request.method==='POST' && options.prepareAction) {
          for(const [id,action] of actions)if(action.expiresAt<=Date.now())actions.delete(id);
          if(actions.size>=30)throw new ConnectorError('too_many_actions','Finish or allow an earlier action to expire.',429);
          const input=await body(request),prepared=await options.prepareAction(input.kind,input.input);
          const id=randomBytes(16).toString('hex'),ticket=randomBytes(32).toString('base64url'),expiresAt=Date.now()+600_000;
          actions.set(id,{...prepared,state:'pending',expiresAt});tickets.set(ticket,{actionId:id,expiresAt});
          return send(response,{actionId:id,status:'waiting_for_user',...(prepared.operationId?{operationId:prepared.operationId}:{}),url:`http://${expectedHost}/local/confirm?ticket=${ticket}`,expiresAt});
        }
        const actionResult=path.match(/^\/admin\/actions\/([a-f0-9]{32})$/);
        if(actionResult && request.method==='GET') {
          const action=actions.get(actionResult[1]);
          if(!action || action.expiresAt<=Date.now())throw new ConnectorError('action_expired','The local action record expired. Check the durable project or file result before considering another operation.',410);
          return send(response,{actionId:actionResult[1],status:action.state,result:action.result});
        }
        if (path === '/admin/pairings' && request.method === 'GET') return send(response,core.pendingPairings());
        const pairing = path.match(/^\/admin\/pairings\/([a-f0-9-]{36})\/(approve|deny|review)$/);
        if (pairing && request.method === 'POST') {
          const input = await body(request);
          if (pairing[2] === 'approve') return send(response,await core.approvePairing(pairing[1],input.code,input.origin));
          if (pairing[2] === 'deny') return send(response,core.denyPairing(pairing[1]));
          const pending = core.pendingPairings().find(row => row.id === pairing[1]);
          if (!pending) throw new ConnectorError('pairing_missing','This request is no longer pending.',404);
          for (const [key,ticket] of tickets) if (ticket.expiresAt <= Date.now()) tickets.delete(key);
          const ticket = randomBytes(32).toString('base64url');
          tickets.set(ticket,{pairingId:pairing[1],expiresAt:pending.expiresAt});
          return send(response,{url:`http://${expectedHost}/local/confirm?ticket=${ticket}`,origin:pending.origin,verificationCode:pending.verificationCode});
        }
        if (path === '/admin/inbox' && request.method === 'GET') return send(response,core.inbox.list().map(({receipt,title})=>({...receipt,title})));
        const entry = path.match(/^\/admin\/inbox\/([\w:.-]{1,200})$/);
        if (entry && request.method === 'GET') {
          const item = core.inbox.get(entry[1]); if (!item) throw new ConnectorError('reference_missing','Reference not found.',404);
          return send(response,item);
        }
        if (path === '/admin/projects' && request.method === 'GET') {
          const host = await core.status(); if (!host.ready) throw new ConnectorError('host_unavailable','Open-Science is not ready.',503);
          return send(response,{hostId:host.hostId ?? host.instanceId,projects:await core.host.listProjects()});
        }
        if (path === '/admin/projects' && request.method === 'POST') {
          const input=await body(request);
          if (typeof input.operationId!=='string' || !/^[\w.-]{1,100}$/.test(input.operationId) || typeof input.name!=='string' || !input.name.trim() || input.name.length>200 || typeof input.expectedHostId!=='string')
            throw new ConnectorError('invalid_project','Provide an operation ID, project name and exact workbench ID.');
          return send(response,await core.createProject(input));
        }
        if (path === '/admin/associations' && request.method === 'POST') {
          const input=await body(request);
          return send(response,await core.associate(input.requestId,input.projectId,input.expectedHostId));
        }
        if (path === '/admin/associations' && request.method === 'GET') {
          const host = await core.status();
          return send(response,core.inbox.links(url.searchParams.get('projectId') ?? '',host.hostId ?? host.instanceId));
        }
        if (options.adminHandler) return send(response,await options.adminHandler(path,request.method ?? 'GET', request.method==='POST' ? await body(request) : Object.fromEntries(url.searchParams)));
      } else if (path === '/local/confirm') {
        if (origin && origin !== `http://${expectedHost}`) throw new ConnectorError('origin_denied','Confirm in the local Connector page.',403);
        const token=url.searchParams.get('ticket') ?? '';
        const ticket=tickets.get(token);
        if (!ticket || ticket.expiresAt<=Date.now()) throw new ConnectorError('confirmation_expired','Request a fresh local confirmation from Open-Science.',410);
        if(ticket.actionId) {
          const action=actions.get(ticket.actionId);
          if(!action || action.state!=='pending')throw new ConnectorError('action_not_pending','This action was already handled.',409);
          if(request.method==='POST') {
            const input=await body(request,true);
            // Body reads yield: consume synchronously after rechecking, before effects.
            if(tickets.get(token)!==ticket || ticket.expiresAt<=Date.now() || action.state!=='pending')throw new ConnectorError('confirmation_expired','This confirmation was already handled or expired.',410);
            if(!['approve','decline'].includes(input.decision))throw new ConnectorError('invalid_decision','Choose an action on the confirmation page.');
            tickets.delete(token);
            if(input.decision!=='approve'){action.state='declined';}
            else {
              action.state='running';
              try{action.result=await action.execute();action.state='complete';}
              catch(error:any){action.state='failed';action.result={error:{code:error instanceof ConnectorError?error.code:'operation_failed',message:error instanceof ConnectorError?error.message:'The operation could not be confirmed. Check local results before trying again.'}};}
            }
            confirmationResult(request,response,action.state==='complete'?'Action completed':action.state==='declined'?'Action declined':'Result needs attention','Return to Open-Science to inspect the result.',action.result);return;
          }
          if(request.method==='GET') {
            const script=confirmationScript(response);
            response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
            response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Review AIPOCH action</title><style>body{font:16px system-ui;max-width:760px;margin:8vh auto;padding:24px;color:#203833;background:#f7f9f7}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:20px;background:white;border:1px solid #d4ddd8}button{font:inherit;padding:12px 20px;border-radius:8px;border:1px solid #a5b7ad}button[value=approve]{background:#155e4b;color:white}</style><h1>Review this action</h1><p>Confirm the exact research reference, workbench, project or file destination below. This action does not execute research code.</p><pre>${escape(JSON.stringify(action.display,null,2))}</pre><form method="post"><button name="decision" value="approve">Confirm action</button> <button name="decision" value="decline">Decline</button></form>${script}</html>`);return;
          }
        }
        const pending=core.pendingPairings().find(row=>row.id===ticket.pairingId);
        if (!pending) throw new ConnectorError('pairing_expired','This connection request is no longer pending.',410);
        if (request.method === 'POST') {
          const input=await body(request,true);
          if(tickets.get(token)!==ticket || ticket.expiresAt<=Date.now())throw new ConnectorError('confirmation_expired','This confirmation was already handled or expired.',410);
          if(!['approve','deny'].includes(input.decision))throw new ConnectorError('invalid_decision','Choose an action on the confirmation page.');
          tickets.delete(token);
          if (input.decision==='approve') await core.approvePairing(pending.id,pending.verificationCode,pending.origin);
          else core.denyPairing(pending.id);
          confirmationResult(request,response,'Connection decision saved','Return to AIPOCH Network.'); return;
        }
        if (request.method === 'GET') {
          const script=confirmationScript(response);
          response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
            response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Connect AIPOCH Network</title><style>body{font:17px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#203833;background:#f7f9f7}h1{font-size:28px}strong{overflow-wrap:anywhere}code{display:block;font-size:32px;letter-spacing:4px;margin:24px 0}button{font:inherit;padding:12px 22px;border:1px solid #b9c9c2;border-radius:8px;cursor:pointer}button[value=approve]{background:#155e4b;color:white}</style><h1>Connect this website to Open-Science?</h1><p>Website: <strong>${escape(pending.origin)}</strong></p><p>Check that this code matches the website:</p><code>${escape(pending.verificationCode)}</code><p>Allow this website to send research references to the local Connector inbox and check its own receipts for 30 minutes. GitHub credentials, private project lists and research execution are not shared.</p><form method="post"><button name="decision" value="approve">Connect Open-Science</button> <button name="decision" value="deny">Decline</button></form>${script}</html>`); return;
        }
      }
      throw new ConnectorError('not_found','This Connector endpoint does not exist.',404);
    } catch (error) {
      const known = error instanceof ConnectorError;
      if (!response.headersSent) send(response,{error:{code:known ? error.code : 'internal_error',message:known ? error.message : 'The operation could not be completed. Use local diagnostics; no automatic retry occurred.'}},known ? error.status : 500);
      else response.end();
    }
  });
  server.requestTimeout=15_000; server.headersTimeout=10_000;
  return server;
}
