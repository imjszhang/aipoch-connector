import { DatabaseSync } from 'node:sqlite';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPublicKey, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConnectorError, digest } from './contracts.js';

export const AUTHORIZATION_VERSION = '1.0' as const;
export const AUTHORIZATION_IDLE_TTL = 90 * 24 * 60 * 60_000;
export const CHALLENGE_TTL = 60_000;
const coordinate = z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine(value => Buffer.from(value, 'base64url').toString('base64url') === value);
const browserAuthorizationSchema = z.object({
  version: z.literal(AUTHORIZATION_VERSION),
  publicKey: z.object({kty:z.literal('EC'),crv:z.literal('P-256'),x:coordinate,y:coordinate}).strict(),
  browserName:z.string().trim().min(1).max(80).refine(value => !/[\x00-\x1f\x7f]/.test(value)),
}).strict();
export type BrowserAuthorization = z.infer<typeof browserAuthorizationSchema>;
export interface Authorization {
  id:string; connectorId:string; origin:string; browserName:string; publicKey:BrowserAuthorization['publicKey'];
  fingerprint:string; hostId:string; createdAt:number; lastUsedAt:number; revokedAt:number|null;
}
export function parseBrowserAuthorization(value:unknown):BrowserAuthorization {
  const result=browserAuthorizationSchema.safeParse(value);
  if(!result.success)throw new ConnectorError('invalid_browser_key','Provide a valid browser public key and display name.');
  try {createPublicKey({key:result.data.publicKey,format:'jwk'});}
  catch {throw new ConnectorError('invalid_browser_key','The browser public key is not a valid P-256 point.');}
  return result.data;
}
export function keyFingerprint(key:BrowserAuthorization['publicKey']) {
  return digest(JSON.stringify({kty:key.kty,crv:key.crv,x:key.x,y:key.y}));
}
export function authorizationSummary(row:Authorization) {
  return {id:row.id,connectorId:row.connectorId,origin:row.origin,browserName:row.browserName,
    createdAt:row.createdAt,lastUsedAt:row.lastUsedAt,expiresAt:row.lastUsedAt+AUTHORIZATION_IDLE_TTL};
}
/** Public keys only. Session/owner/workbench tokens are never written here. */
export class AuthorizationStore {
  private db:DatabaseSync;
  readonly connectorId:string;
  constructor(path:string) {
    if(path!==':memory:') {
      mkdirSync(dirname(path),{recursive:true,mode:0o700});
      try {const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)||(typeof process.getuid==='function'&&info.uid!==process.getuid()))throw new Error('Authorization database must be an owner-protected regular file.');}
      catch(error:any){if(error.code!=='ENOENT')throw error;}
    }
    this.db=new DatabaseSync(path);
    if(path!==':memory:')chmodSync(path,0o600);
    const version=(this.db.prepare('PRAGMA user_version').get() as any).user_version;
    if(version>1){this.db.close();throw new Error('Authorization database requires a newer Connector. Its data was preserved.');}
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    try {
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1),connector_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS authorizations (id TEXT PRIMARY KEY,origin TEXT NOT NULL,browser_name TEXT NOT NULL,
          public_key TEXT NOT NULL,fingerprint TEXT NOT NULL,host_id TEXT NOT NULL,created_at INTEGER NOT NULL,
          last_used_at INTEGER NOT NULL,revoked_at INTEGER);
        PRAGMA user_version=1;`);
      if(!this.db.prepare('SELECT connector_id FROM identity WHERE singleton=1').get()&&(this.db.prepare('SELECT COUNT(*) AS count FROM authorizations').get() as any).count>0)throw new Error('Existing authorizations lack their Connector identity; preserve the database for diagnosis.');
      this.db.prepare('INSERT OR IGNORE INTO identity VALUES (1,?)').run(randomUUID());
      this.connectorId=(this.db.prepare('SELECT connector_id FROM identity WHERE singleton=1').get() as any).connector_id;
      if(!/^[a-f0-9-]{36}$/.test(this.connectorId))throw new Error('Connector installation identity is invalid; preserve the database for diagnosis.');
      this.db.exec('COMMIT');
    }catch(error){this.db.close();throw error;}
  }
  create(origin:string,hostId:string,browser:BrowserAuthorization,now:number):Authorization {
    const id=randomUUID();
    this.db.prepare('INSERT INTO authorizations VALUES (?,?,?,?,?,?,?,?,NULL)').run(id,origin,browser.browserName,
      JSON.stringify(browser.publicKey),keyFingerprint(browser.publicKey),hostId,now,now);
    return this.get(id)!;
  }
  get(id:string):Authorization|undefined {
    const row=this.db.prepare('SELECT * FROM authorizations WHERE id=?').get(id) as any;
    return row?{id:row.id,connectorId:this.connectorId,origin:row.origin,browserName:row.browser_name,
      publicKey:JSON.parse(row.public_key),fingerprint:row.fingerprint,hostId:row.host_id,
      createdAt:row.created_at,lastUsedAt:row.last_used_at,revokedAt:row.revoked_at}:undefined;
  }
  require(id:string,origin:string,connectorId:string,now:number):Authorization {
    if(connectorId!==this.connectorId)throw new ConnectorError('connector_changed','This browser was authorized with a different Connector installation. Pair again.',409);
    const row=this.get(id);
    if(!row||row.origin!==origin)throw new ConnectorError('authorization_unknown','This browser authorization is not known for this website.',404);
    if(row.revokedAt!==null)throw new ConnectorError('authorization_revoked','This browser authorization was forgotten. Pair again.',401);
    if(row.lastUsedAt+AUTHORIZATION_IDLE_TTL<=now)throw new ConnectorError('authorization_expired','This browser authorization expired after 90 days without use. Pair again.',401);
    return row;
  }
  touch(id:string,now:number) {
    this.db.prepare('UPDATE authorizations SET last_used_at=MAX(last_used_at,?) WHERE id=? AND revoked_at IS NULL').run(now,id);
  }
  revoke(id:string,now:number) {
    if(!this.get(id))throw new ConnectorError('authorization_unknown','This browser authorization does not exist.',404);
    this.db.prepare('UPDATE authorizations SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(now,id);
  }
  list(now:number) {
    return (this.db.prepare('SELECT id FROM authorizations ORDER BY last_used_at DESC,id').all() as any[]).map(({id})=>{
      const row=this.get(id)!;
      return {...authorizationSummary(row),fingerprint:row.fingerprint,revokedAt:row.revokedAt,
        status:row.revokedAt!==null?'revoked':row.lastUsedAt+AUTHORIZATION_IDLE_TTL<=now?'expired':'active'};
    });
  }
  close(){this.db.close();}
}
