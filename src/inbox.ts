import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { ConnectorError, PROTOCOL_VERSION, type Submission, type Receipt } from './contracts.js';

export interface InboxEntry { receipt: Receipt; submission: Submission; hostInstanceId: string; title: string }
export interface Association { requestId: string; hostInstanceId: string; projectId: string; projectName: string; linkedAt: number }
export interface OperationRecord {
  operationId: string;
  inputHash: string;
  state: 'pending' | 'complete';
  result?: unknown;
  outcome: 'unknown' | 'complete';
  retryAllowed: false;
  identityVersion?: string;
  input?: unknown;
}
export class Inbox {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      try { if (lstatSync(path).isSymbolicLink()) throw new Error('Inbox cannot be a symbolic link.'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    }
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
    const version = (this.db.prepare('PRAGMA user_version').get() as any).user_version;
    if (version > 2) { this.db.close(); throw new Error('This inbox was created by a newer Connector. Its data was not modified.'); }
    try { this.db.exec(`BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS receipts (
      request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, object_id TEXT NOT NULL,
      content_hash TEXT NOT NULL, submission TEXT NOT NULL, host_id TEXT NOT NULL,
      title TEXT NOT NULL, received_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS associations (
      request_id TEXT NOT NULL REFERENCES receipts(request_id), host_id TEXT NOT NULL,
      project_id TEXT NOT NULL, project_name TEXT NOT NULL, linked_at INTEGER NOT NULL,
      PRIMARY KEY(request_id,host_id,project_id));
      CREATE TABLE IF NOT EXISTS operations (
      operation_id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, state TEXT NOT NULL, result TEXT);
      CREATE TABLE IF NOT EXISTS operation_evidence (
      operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id), identity_version TEXT NOT NULL, input TEXT NOT NULL);
      PRAGMA user_version=2; COMMIT;`);
    } catch (error) { this.db.close(); throw error; }
  }
  receive(submission: Submission, hostInstanceId: string, now = Date.now()): Receipt {
    const previous = this.get(submission.requestId);
    if (previous) {
      if (previous.submission.sessionId !== submission.sessionId || previous.submission.objectId !== submission.objectId ||
          previous.submission.review.content !== submission.review.content || previous.hostInstanceId !== hostInstanceId)
        throw new ConnectorError('request_conflict', 'This request ID already refers to different content or a different session.', 409);
      return previous.receipt;
    }
    const title = JSON.parse(submission.review.content).object.title as string;
    this.db.prepare('INSERT INTO receipts VALUES (?,?,?,?,?,?,?,?)').run(submission.requestId, submission.sessionId,
      submission.objectId, submission.review.sha256, JSON.stringify(submission), hostInstanceId, title, now);
    return this.get(submission.requestId)!.receipt;
  }
  get(requestId: string): InboxEntry | undefined {
    const row = this.db.prepare('SELECT * FROM receipts WHERE request_id=?').get(requestId) as any;
    if (!row) return;
    return { receipt: { protocolVersion: PROTOCOL_VERSION, requestId: row.request_id, sessionId: row.session_id,
      objectId: row.object_id, contentSha256: row.content_hash, outcome: 'received', receivedAt: row.received_at },
      submission: JSON.parse(row.submission), hostInstanceId: row.host_id, title: row.title };
  }
  list(limit = 50) {
    return (this.db.prepare('SELECT request_id FROM receipts ORDER BY received_at DESC LIMIT ?').all(Math.min(100, Math.max(1, limit))) as any[])
      .map(row => this.get(row.request_id)!);
  }
  associate(link: Association) {
    if (!this.get(link.requestId)) throw new ConnectorError('reference_missing', 'The received reference was not found.', 404);
    this.db.prepare('INSERT INTO associations VALUES (?,?,?,?,?) ON CONFLICT(request_id,host_id,project_id) DO NOTHING')
      .run(link.requestId, link.hostInstanceId, link.projectId, link.projectName, link.linkedAt);
    return this.links(link.projectId, link.hostInstanceId).find(item => item.requestId === link.requestId)!;
  }
  links(projectId: string, hostInstanceId: string): Association[] {
    return (this.db.prepare('SELECT * FROM associations WHERE project_id=? AND host_id=?').all(projectId, hostInstanceId) as any[])
      .map(row => ({ requestId: row.request_id, hostInstanceId: row.host_id, projectId: row.project_id, projectName: row.project_name, linkedAt: row.linked_at }));
  }
  beginOperation(id: string, hash: string, evidence?: {identityVersion: string; input: unknown; legacyHash: string}): { state: string; result?: unknown } {
    const existing = this.db.prepare('SELECT * FROM operations WHERE operation_id=?').get(id) as any;
    if (existing) {
      const saved = this.db.prepare('SELECT identity_version FROM operation_evidence WHERE operation_id=?').get(id) as any;
      if (evidence && !saved) {
        if (existing.input_hash !== evidence.legacyHash) throw new ConnectorError('legacy_operation_unverifiable', 'This older operation lacks its original input. Inspect operations show with the original ID and its destination; do not retry with a new ID automatically.', 409);
        return {state:existing.state, result:existing.result ? JSON.parse(existing.result) : undefined};
      }
      if (saved && saved.identity_version !== evidence?.identityVersion) throw new ConnectorError('operation_conflict', 'This operation ID belongs to a different operation identity format.', 409);
      if (existing.input_hash !== hash) throw new ConnectorError('operation_conflict', 'This operation ID was used with different inputs.', 409);
      return {state: existing.state, result: existing.result ? JSON.parse(existing.result) : undefined};
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO operations VALUES (?,?,?,NULL)').run(id, hash, 'pending');
      if (evidence) this.db.prepare('INSERT INTO operation_evidence VALUES (?,?,?)').run(id, evidence.identityVersion, JSON.stringify(evidence.input));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { state: 'new' };
  }
  finishOperation(id: string, result: unknown) {
    this.db.prepare('UPDATE operations SET state=?,result=? WHERE operation_id=?').run('complete', JSON.stringify(result), id);
  }
  /** Read existing evidence only. A pending record is not proof that no write occurred. */
  getOperation(id: string): OperationRecord | undefined {
    if (typeof id !== 'string' || !/^[\w.-]{1,100}$/.test(id))
      throw new ConnectorError('operation_id_required', 'Provide the original operation ID using letters, numbers, underscores, dots or hyphens.');
    const row = this.db.prepare('SELECT * FROM operations WHERE operation_id=?').get(id) as any;
    if (!row) return;
    if (row.state !== 'pending' && row.state !== 'complete')
      throw new ConnectorError('operation_record_invalid', 'The operation record has an unsupported state. Preserve it for local diagnosis.', 409);
    const evidence = this.db.prepare('SELECT * FROM operation_evidence WHERE operation_id=?').get(id) as any;
    return { ...(evidence ? {identityVersion:evidence.identity_version, input:JSON.parse(evidence.input)} : {}), operationId: row.operation_id, inputHash: row.input_hash, state: row.state,
      result: row.state === 'complete' && row.result !== null ? JSON.parse(row.result) : undefined,
      outcome: row.state === 'complete' ? 'complete' : 'unknown', retryAllowed: false };
  }
  listOperations(limit = 50): OperationRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new ConnectorError('invalid_limit', 'Choose an operation limit between 1 and 100.');
    return (this.db.prepare('SELECT operation_id FROM operations ORDER BY rowid DESC LIMIT ?').all(limit) as any[])
      .map(row => this.getOperation(row.operation_id)!);
  }
  close() { this.db.close(); }
}
