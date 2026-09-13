import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ConnectorError, PAIRING_TTL, SESSION_TTL, digest, parseSubmission, type Host, type HostStatus, type Submission } from './contracts.js';
import { Inbox } from './inbox.js';

interface Pairing { id: string; origin: string; attemptId: string; verificationCode: string; pollToken: string;
  expiresAt: number; status: 'pending'|'approved'|'denied'; instanceId: string; sessionId?: string }
interface Session { id: string; token: string; origin: string; instanceId: string; expiresAt: number }
const secret = () => randomBytes(32).toString('base64url');
export function equalSecret(value: string | undefined, expected: string) {
  if (!value) return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export class ConnectorCore {
  private pairings = new Map<string, Pairing>();
  private sessions = new Map<string, Session>();
  constructor(readonly inbox: Inbox, readonly host: Host, private now = () => Date.now(),
    private referenceGuard?: (submission: Submission) => Promise<void>) {}
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
  async pair(origin: string, attemptId: string) {
    const status = await this.requireHost();
    for (const [id, pair] of this.pairings) if (pair.expiresAt <= this.now()) this.pairings.delete(id);
    if (this.pairings.size >= 20) throw new ConnectorError('too_many_pairings', 'Too many connection requests. Wait for an earlier request to expire.', 429);
    const pairing: Pairing = { id: randomUUID(), origin, attemptId, pollToken: secret(), expiresAt: this.now() + PAIRING_TTL,
      verificationCode: randomBytes(4).toString('hex').toUpperCase(), status: 'pending', instanceId: status.instanceId };
    this.pairings.set(pairing.id, pairing);
    return { pairingId: pairing.id, expiresAt: pairing.expiresAt, verificationCode: pairing.verificationCode, pollToken: pairing.pollToken };
  }
  pendingPairings() {
    return [...this.pairings.values()].filter(pair => pair.expiresAt > this.now() && pair.status === 'pending')
      .map(({id, origin, verificationCode, expiresAt}) => ({id, origin, verificationCode, expiresAt}));
  }
  private pairing(id: string) {
    const pairing = this.pairings.get(id);
    if (!pairing || pairing.expiresAt <= this.now()) throw new ConnectorError('pairing_expired', 'This connection request has expired.', 410);
    return pairing;
  }
  async approvePairing(id: string, code: string, origin: string) {
    const pair = this.pairing(id);
    if (pair.status !== 'pending' || !equalSecret(code, pair.verificationCode) || origin !== pair.origin)
      throw new ConnectorError('pairing_mismatch', 'The connection code and website must match the pending request.', 409);
    const status = await this.requireHost();
    // Host authentication yields; a decline, expiry or competing approval can win meanwhile.
    if (this.pairing(id) !== pair || pair.status !== 'pending')
      throw new ConnectorError('pairing_mismatch', 'This connection request is no longer pending.', 409);
    if (status.instanceId !== pair.instanceId) throw new ConnectorError('host_changed', 'The workbench restarted. Request a new connection.', 409);
    const session: Session = { id: randomUUID(), token: secret(), origin: pair.origin, instanceId: pair.instanceId, expiresAt: this.now() + SESSION_TTL };
    this.sessions.set(session.id, session); pair.sessionId = session.id; pair.status = 'approved';
    return { approved: true, origin, expiresAt: session.expiresAt };
  }
  denyPairing(id: string) {
    const pair = this.pairing(id);
    if (pair.sessionId) this.sessions.delete(pair.sessionId);
    pair.status = 'denied'; return { denied: true };
  }
  async pollPairing(id: string, token: string, origin: string) {
    const pair = this.pairing(id);
    if (!equalSecret(token, pair.pollToken) || origin !== pair.origin) throw new ConnectorError('unauthorized', 'This pairing request is not authorized.', 401);
    if (pair.status !== 'approved') return { status: pair.status };
    await this.requireHost();
    const session = this.sessions.get(pair.sessionId!);
    if (!session) throw new ConnectorError('session_expired', 'The connection is no longer valid.', 401);
    return { status: 'approved', session: { id: session.id, token: session.token, expiresAt: session.expiresAt, protocolVersion: '1.0' } };
  }
  async session(token: string, origin: string) {
    await this.requireHost();
    const session = [...this.sessions.values()].find(row => equalSecret(token, row.token) && row.origin === origin);
    if (!session) throw new ConnectorError('unauthorized', 'Reconnect before continuing.', 401);
    return session;
  }
  async disconnect(token: string, origin: string) {
    const session = [...this.sessions.values()].find(row => equalSecret(token, row.token) && row.origin === origin);
    if (session) this.sessions.delete(session.id);
    return { disconnected: true };
  }
  async receive(input: unknown, token: string, origin: string) {
    const session = await this.session(token, origin);
    const submission = parseSubmission(input);
    if (submission.sessionId !== session.id) throw new ConnectorError('session_mismatch', 'The reference was confirmed for another connection.', 409);
    // Replayed exact requests use the existing durable result, not a newer catalog projection.
    if (!this.inbox.get(submission.requestId)) await this.referenceGuard?.(submission);
    const current = await this.session(token, origin);
    if (current.instanceId !== session.instanceId) throw new ConnectorError('host_changed', 'The workbench changed before receipt.', 409);
    return this.inbox.receive(submission, session.instanceId, this.now());
  }
  async receipt(requestId: string, token: string, origin: string) {
    const session = await this.session(token, origin);
    const entry = this.inbox.get(requestId);
    if (!entry || entry.submission.sessionId !== session.id) throw new ConnectorError('receipt_missing', 'No receipt is available for this session and request.', 404);
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
