import { randomBytes, randomUUID, timingSafeEqual, createPublicKey, verify } from 'node:crypto';
import { ConnectorError, PAIRING_TTL, SESSION_TTL, digest, parseSubmission, type Host, type HostStatus, type Submission } from './contracts.js';
import { AuthorizationStore, AUTHORIZATION_VERSION, AUTHORIZATION_IDLE_TTL, CHALLENGE_TTL, parseBrowserAuthorization, keyFingerprint, authorizationSummary, type BrowserAuthorization } from './authorizations.js';
import { Inbox } from './inbox.js';

interface Pairing { id: string; origin: string; attemptId: string; verificationCode: string; pollToken: string;
  expiresAt: number; status: 'pending'|'approved'|'denied'; instanceId: string; hostId?:string; browserAuthorization?:BrowserAuthorization; authorizationId?:string; sessionId?: string }
interface Session { id: string; token: string; origin: string; instanceId: string; expiresAt: number; authorizationId?:string }
const secret = () => randomBytes(32).toString('base64url');
export function equalSecret(value: string | undefined, expected: string) {
  if (!value) return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export class ConnectorCore {
  private pairings = new Map<string, Pairing>();
  private sessions = new Map<string, Session>();
  private challenges = new Map<string,{id:string;authorizationId:string;origin:string;purpose:'resume'|'revoke';challenge:string;expiresAt:number}>();
  constructor(readonly inbox: Inbox, readonly host: Host, private now = () => Date.now(),
    private referenceGuard?: (submission: Submission) => Promise<void>, readonly authorizations?:AuthorizationStore) {}
  async status(): Promise<HostStatus> {
    try { return await this.host.status(); }
    catch { return { ready: false, instanceId: '', reason: 'Open-Science could not be authenticated.' }; }
  }
  private async requireHost() {
    const status = await this.status();
    if (!status.ready || !status.instanceId) { this.sessions.clear(); throw new ConnectorError('host_unavailable', 'Open-Science is not currently available. Continue in the workbench and try connecting again.', 503); }
    for (const [id, session] of this.sessions) if (session.instanceId !== status.instanceId || session.expiresAt <= this.now()) this.sessions.delete(id);
    return status;
  }
  async pair(origin: string, attemptId: string, browserInput?:unknown) {
    const browserAuthorization=browserInput===undefined?undefined:parseBrowserAuthorization(browserInput);
    if(browserAuthorization&&!this.authorizations)throw new ConnectorError('unsupported_protocol','Persistent browser authorization is not available.');
    const status = await this.requireHost();
    for (const [id, pair] of this.pairings) if (pair.expiresAt <= this.now()) this.pairings.delete(id);
    if (this.pairings.size >= 20) throw new ConnectorError('too_many_pairings', 'Too many connection requests. Wait for an earlier request to expire.', 429);
    const pairing: Pairing = { id: randomUUID(), origin, attemptId, pollToken: secret(), expiresAt: this.now() + PAIRING_TTL,
      verificationCode: randomBytes(4).toString('hex').toUpperCase(), status: 'pending', instanceId: status.instanceId, hostId:status.hostId, browserAuthorization };
    if(browserAuthorization&&!status.hostId)throw new ConnectorError('unsupported_host_identity','This workbench does not provide a stable identity for remembered authorization.');
    this.pairings.set(pairing.id, pairing);
    return { pairingId: pairing.id, expiresAt: pairing.expiresAt, verificationCode: pairing.verificationCode, pollToken: pairing.pollToken };
  }
  pendingPairings() {
    return [...this.pairings.values()].filter(pair => pair.expiresAt > this.now() && pair.status === 'pending')
      .map(({id, origin, verificationCode, expiresAt,browserAuthorization}) => ({id, origin, verificationCode, expiresAt,...(browserAuthorization?{browserName:browserAuthorization.browserName,keyFingerprint:keyFingerprint(browserAuthorization.publicKey),rememberAvailable:true}:{})}));
  }
  private pairing(id: string) {
    const pairing = this.pairings.get(id);
    if (!pairing || pairing.expiresAt <= this.now()) throw new ConnectorError('pairing_expired', 'This connection request has expired.', 410);
    return pairing;
  }
  async approvePairing(id: string, code: string, origin: string, remember=false) {
    const pair = this.pairing(id);
    if (pair.status !== 'pending' || !equalSecret(code, pair.verificationCode) || origin !== pair.origin)
      throw new ConnectorError('pairing_mismatch', 'The connection code and website must match the pending request.', 409);
    const status = await this.requireHost();
    // Host authentication yields; a decline, expiry or competing approval can win meanwhile.
    if (this.pairing(id) !== pair || pair.status !== 'pending')
      throw new ConnectorError('pairing_mismatch', 'This connection request is no longer pending.', 409);
    if (status.instanceId !== pair.instanceId || status.hostId!==pair.hostId) throw new ConnectorError('host_changed', 'The workbench restarted. Request a new connection.', 409);
    const session: Session = { id: randomUUID(), token: secret(), origin: pair.origin, instanceId: pair.instanceId, expiresAt: this.now() + SESSION_TTL };
    if(remember&&pair.browserAuthorization&&this.authorizations){session.authorizationId=this.authorizations.create(pair.origin,pair.hostId!,pair.browserAuthorization,this.now()).id;pair.authorizationId=session.authorizationId;}
    this.sessions.set(session.id, session); pair.sessionId = session.id; pair.status = 'approved';
    return { approved: true, origin, expiresAt: session.expiresAt };
  }
  denyPairing(id: string) {
    const pair = this.pairing(id);
    if(pair.authorizationId)this.revokeAuthorization(pair.authorizationId);
    if(pair.sessionId)this.sessions.delete(pair.sessionId);
    pair.status = 'denied'; return { denied: true };
  }
  async pollPairing(id: string, token: string, origin: string) {
    const pair = this.pairing(id);
    if (!equalSecret(token, pair.pollToken) || origin !== pair.origin) throw new ConnectorError('unauthorized', 'This pairing request is not authorized.', 401);
    if (pair.status !== 'approved') return { status: pair.status };
    await this.requireHost();
    const session = this.sessions.get(pair.sessionId!);
    if (!session) throw new ConnectorError('session_expired', 'The connection is no longer valid.', 401);
    const authorization=session.authorizationId?this.authorizations!.require(session.authorizationId,origin,this.authorizations!.connectorId,this.now()):undefined;
    return { status: 'approved', session: this.sessionSummary(session), ...(authorization?{authorization:authorizationSummary(authorization)}:{}) };
  }
  async session(token: string, origin: string, recordUse=true) {
    const status=await this.requireHost();
    const session = [...this.sessions.values()].find(row => equalSecret(token, row.token) && row.origin === origin);
    if (!session) throw new ConnectorError('unauthorized', 'Reconnect before continuing.', 401);
    if(session.authorizationId){
      const grant=this.authorizations!.require(session.authorizationId,origin,this.authorizations!.connectorId,this.now());
      if(grant.hostId!==status.hostId){this.sessions.delete(session.id);throw new ConnectorError('host_changed','This authorization belongs to another workbench. Pair again.',409);}
      if(recordUse)this.authorizations!.touch(grant.id,this.now());
    }
    return session;
  }
  async disconnect(token: string, origin: string) {
    const session = [...this.sessions.values()].find(row => equalSecret(token, row.token) && row.origin === origin);
    if (session) this.sessions.delete(session.id);
    return { disconnected: true };
  }
  private sessionSummary(session:Session) {
    return {id:session.id,token:session.token,expiresAt:session.expiresAt,protocolVersion:'1.0' as const};
  }
  capabilities() {
    return {protocolVersion:'1.0',...(this.authorizations?{persistentAuthorization:{version:AUTHORIZATION_VERSION,
      connectorId:this.authorizations.connectorId,algorithm:'ECDSA-P256-SHA256',idleTtlMs:AUTHORIZATION_IDLE_TTL,challengeTtlMs:CHALLENGE_TTL}}:{})};
  }
  private store() {
    if(!this.authorizations)throw new ConnectorError('unsupported_protocol','Persistent browser authorization is unavailable.');
    return this.authorizations;
  }
  private authorizationInput(input:any,fields:string[]) {
    if(!input||typeof input!=='object'||Array.isArray(input)||input.version!==AUTHORIZATION_VERSION||
      Object.keys(input).length!==fields.length||fields.some(key=>typeof input[key]!=='string'))
      throw new ConnectorError('unsupported_protocol','The browser authorization request is invalid.');
  }
  authorizationChallenge(id:string,origin:string,input:any) {
    this.authorizationInput(input,['version','connectorId','purpose']);
    if(!['resume','revoke'].includes(input.purpose))throw new ConnectorError('unsupported_protocol','Choose a supported authorization action.');
    const store=this.store();store.require(id,origin,input.connectorId,this.now());
    for(const [key,row] of this.challenges)if(row.expiresAt<=this.now())this.challenges.delete(key);
    if(this.challenges.size>=200||[...this.challenges.values()].filter(row=>row.authorizationId===id).length>=20)
      throw new ConnectorError('too_many_challenges','Wait for an earlier browser challenge to expire.',429);
    const challengeId=randomUUID(),expiresAt=this.now()+CHALLENGE_TTL;
    const challenge=JSON.stringify(['aipoch-browser-authorization',AUTHORIZATION_VERSION,store.connectorId,origin,id,input.purpose,challengeId,secret(),expiresAt]);
    this.challenges.set(challengeId,{id:challengeId,authorizationId:id,origin,purpose:input.purpose,challenge,expiresAt});
    return {challengeId,challenge,expiresAt};
  }
  private consumeProof(id:string,origin:string,purpose:'resume'|'revoke',input:any) {
    this.authorizationInput(input,['version','connectorId','challengeId','signature']);
    const store=this.store(),grant=store.require(id,origin,input.connectorId,this.now());
    const challenge=this.challenges.get(input.challengeId);
    if(!challenge||challenge.expiresAt<=this.now())throw new ConnectorError('challenge_expired','Request a fresh browser verification challenge.',410);
    if(challenge.authorizationId!==id||challenge.origin!==origin)
      throw new ConnectorError('invalid_proof','The browser proof does not match this authorization action.',401);
    // Consume synchronously before host authentication can yield; one proof has one outcome.
    this.challenges.delete(challenge.id);
    if(challenge.purpose!==purpose)throw new ConnectorError('invalid_proof','The browser proof was issued for another action.',401);
    let valid=false;
    if(/^[A-Za-z0-9_-]{86}$/.test(input.signature)) {
      const signature=Buffer.from(input.signature,'base64url');
      if(signature.length===64&&signature.toString('base64url')===input.signature)
        valid=verify('sha256',Buffer.from(challenge.challenge,'utf8'),{key:createPublicKey({key:grant.publicKey,format:'jwk'}),dsaEncoding:'ieee-p1363'},signature);
    }
    if(!valid)throw new ConnectorError('invalid_proof','The browser identity could not be verified.',401);
    return {grant,challenge};
  }
  async resumeAuthorization(id:string,origin:string,input:any) {
    const {grant,challenge}=this.consumeProof(id,origin,'resume',input);
    const status=await this.status();
    // Durable revocation, expiry or restart races must win before any new session is issued.
    const current=this.store().require(id,origin,input.connectorId,this.now());
    if(challenge.expiresAt<=this.now())throw new ConnectorError('challenge_expired','Browser verification expired while checking the workbench.',410);
    if(!status.ready||!status.instanceId){this.sessions.clear();throw new ConnectorError('authorized_host_unavailable','Browser authorization is valid. Waiting for Open-Science to become available.',503);}
    if(current.hostId!==status.hostId||grant.hostId!==status.hostId)
      throw new ConnectorError('host_changed','This browser was authorized for a different workbench. Pair again.',409);
    const session:Session={id:randomUUID(),token:secret(),origin,instanceId:status.instanceId,
      expiresAt:this.now()+SESSION_TTL,authorizationId:id};
    this.store().touch(id,this.now());this.sessions.set(session.id,session);
    return {session:this.sessionSummary(session),authorization:authorizationSummary(this.store().get(id)!)};
  }
  revokeAuthorization(id:string) {
    this.store().revoke(id,this.now());
    for(const [key,session] of this.sessions)if(session.authorizationId===id)this.sessions.delete(key);
    for(const [key,challenge] of this.challenges)if(challenge.authorizationId===id)this.challenges.delete(key);
    return {revoked:true};
  }
  revokeAuthorizationProof(id:string,origin:string,input:any) {
    this.consumeProof(id,origin,'revoke',input);
    return this.revokeAuthorization(id);
  }
  listAuthorizations(){return this.store().list(this.now());}
  async receive(input: unknown, token: string, origin: string) {
    const session = await this.session(token, origin,false);
    const submission = parseSubmission(input);
    if (submission.sessionId !== session.id) throw new ConnectorError('session_mismatch', 'The reference was confirmed for another connection.', 409);
    // Replayed exact requests use the existing durable result, not a newer catalog projection.
    if (!this.inbox.get(submission.requestId)) await this.referenceGuard?.(submission);
    const current = await this.session(token, origin,false);
    if (current.instanceId !== session.instanceId) throw new ConnectorError('host_changed', 'The workbench changed before receipt.', 409);
    const receipt=this.inbox.receive(submission, session.instanceId, this.now());
    if(session.authorizationId)this.authorizations!.touch(session.authorizationId,this.now());
    return receipt;
  }
  async receipt(requestId: string, token: string, origin: string) {
    const session = await this.session(token, origin,false);
    const entry = this.inbox.get(requestId);
    if (!entry || entry.submission.sessionId !== session.id) throw new ConnectorError('receipt_missing', 'No receipt is available for this session and request.', 404);
    if(session.authorizationId)this.authorizations!.touch(session.authorizationId,this.now());
    return entry.receipt;
  }
  async associate(requestId: string, projectId: string, expectedHostId: string) {
    const status = await this.requireHost();
    const hostId = status.hostId ?? status.instanceId;
    if (hostId !== expectedHostId) throw new ConnectorError('host_changed', 'Select the project again for this workbench.', 409);
    const project = (await this.host.listProjects()).find(row => row.id === projectId);
    if (!project) throw new ConnectorError('project_missing', 'Select an existing project from this workbench.', 404);
    const after = await this.requireHost();
    if (after.instanceId !== status.instanceId) throw new ConnectorError('host_changed', 'The workbench changed during project selection.', 409);
    return this.inbox.associate({requestId, hostInstanceId: hostId, projectId, projectName: project.name, linkedAt: this.now()});
  }
  async createProject(input: {operationId:string; name:string; description?:string; expectedHostId:string}) {
    const status = await this.requireHost();
    if ((status.hostId ?? status.instanceId) !== input.expectedHostId) throw new ConnectorError('host_changed', 'Select the workbench again.', 409);
    const previous = this.inbox.beginOperation(input.operationId, digest(JSON.stringify(input)));
    if (previous.state === 'complete') return previous.result;
    if (previous.state !== 'new') throw new ConnectorError('result_unconfirmed', 'An earlier project creation may have succeeded. List projects and explicitly associate the existing project before attempting another creation.', 409);
    // A lost reply leaves a durable pending entry. Never silently repeat an uncertain host write.
    const request = {name: input.name, description: input.description, idempotencyKey: input.operationId,
      expectedHostId: input.expectedHostId};
    const project = await this.host.createProject(request);
    const after = await this.status();
    if (!after.ready || after.instanceId !== status.instanceId ||
        (after.hostId ?? after.instanceId) !== input.expectedHostId)
      throw new ConnectorError('result_unconfirmed', 'The workbench changed after project creation. The project may exist; inspect local projects before associating it or considering another creation.', 409);
    const result = { project, hostId: input.expectedHostId };
    this.inbox.finishOperation(input.operationId, result); return result;
  }
}
