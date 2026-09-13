import { DeviceAuthorization, githubJson, type DeviceChallenge, type DeviceToken, type GithubFetch } from './github/index.js';
import { ConnectorError } from './contracts.js';

export interface GithubCredentialStore {
  getGithub(): Promise<DeviceToken | undefined>;
  getGithubForRefresh(): Promise<DeviceToken | undefined>;
  setGithub(token: DeviceToken): Promise<void>;
  deleteGithub(): Promise<void>;
}
interface DeviceFlow {
  start(): Promise<DeviceChallenge>;
  poll(code: string, interval: number, expiresAt: number, options: { signal?: AbortSignal }): Promise<DeviceToken>;
}
export interface GithubAuthDependencies { createDevice?: (clientId: string) => DeviceFlow; fetch?: GithubFetch }
export type GithubAuthStatus = { status: 'pending'; userCode?: string; verificationUri?: string; expiresAt?: number }
  | { status: 'saving' | 'refreshing' | 'signed_out' | 'not_configured' }
  | { status: 'authorized'; expiresAt: number | null } | { status: 'failed'; code: string };
interface Operation {
  generation: number; controller: AbortController; kind: 'authorization' | 'refresh';
  invalidatedBy?: 'cancel' | 'logout';
  saving?: boolean;
  challenge?: Pick<DeviceChallenge, 'userCode' | 'verificationUri' | 'expiresAt'>;
}
const SAFE_CODE = new Set(['authorization_expired', 'authorization_denied', 'authorization_cancelled',
  'credential_store_unsupported', 'credential_store_unavailable', 'credential_invalid', 'credential_write_unconfirmed']);
const safeSecret = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\u0000-\u0020\u007f]/.test(v);
const safeTime = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const safeClient = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.-]{4,200}$/.test(v);
function safeFailure(error: unknown, fallback: string): string {
  const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && SAFE_CODE.has(code) ? code : fallback;
}
function authError(code: string): ConnectorError {
  const messages: Record<string, string> = {
    authorization_pending: 'A GitHub authorization operation is already pending.',
    github_not_configured: 'Configure the registered GitHub application client ID in Connector setup first.',
    authorization_cancelled: 'Stopped waiting for GitHub authorization.',
    authorization_expired: 'GitHub device authorization expired.',
    authorization_failed: 'GitHub authorization could not be completed.',
    github_authorization_expired: 'GitHub authorization expired or was rejected. Sign in again through Connector.',
    github_refresh_unconfirmed: 'The GitHub refresh result could not be confirmed. Sign in again; the refresh will not be repeated automatically.',
    credential_store_unavailable: 'The protected credential operation could not be completed.',
  };
  return new ConnectorError(code, messages[code] ?? 'GitHub authorization is unavailable.',
    code === 'authorization_pending' ? 409 : code.startsWith('github_') ? 401 : 400);
}
function validatedToken(v: DeviceToken): DeviceToken {
  if (!v || !safeSecret(v.accessToken) || v.tokenType !== 'bearer' ||
      (v.expiresAt !== undefined && !safeTime(v.expiresAt)) ||
      (v.refreshToken !== undefined && !safeSecret(v.refreshToken)) ||
      (v.refreshTokenExpiresAt !== undefined && (!safeTime(v.refreshTokenExpiresAt) || !v.refreshToken)) ||
      (v.scope !== undefined && (typeof v.scope !== 'string' || v.scope.length > 4096 || /[\u0000-\u001f\u007f]/.test(v.scope)))) throw authError('authorization_failed');
  return { accessToken: v.accessToken, tokenType: 'bearer',
    ...(v.expiresAt !== undefined ? { expiresAt: v.expiresAt } : {}),
    ...(v.refreshToken !== undefined ? { refreshToken: v.refreshToken } : {}),
    ...(v.refreshTokenExpiresAt !== undefined ? { refreshTokenExpiresAt: v.refreshTokenExpiresAt } : {}),
    ...(v.scope !== undefined ? { scope: v.scope } : {}) };
}

/** Generations reject late network work; all credential mutations share one serialized owner. */
export class GithubAuth {
  private flow?: Operation;
  private refreshOperation?: Operation;
  private generation = 0;
  private failure?: string;
  private cached?: DeviceToken;
  private loaded = false;
  private loadJob?: Promise<void>;
  private refreshJob?: Promise<string | undefined>;
  private writes: Promise<void> = Promise.resolve();
  private readonly createDevice: NonNullable<GithubAuthDependencies['createDevice']>;
  private readonly fetcher: GithubFetch;

  constructor(private readonly store: GithubCredentialStore, private clientId?: string,
    private readonly now = () => Date.now(), dependencies: GithubAuthDependencies = {}) {
    this.fetcher = dependencies.fetch ?? globalThis.fetch;
    this.createDevice = dependencies.createDevice ?? (id => new DeviceAuthorization({ clientId: id, fetch: this.fetcher, now: this.now }));
  }
  private active(op: Operation): boolean { return op.generation === this.generation && !op.controller.signal.aborted; }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const task = this.writes.then(action);
    this.writes = task.then(() => undefined, () => undefined);
    return task;
  }
  private async load(): Promise<void> {
    await this.writes;
    if (this.loaded || this.failure) return;
    if (!this.loadJob) {
      const generation = this.generation;
      const task = (async () => {
        try {
          const token = await this.store.getGithubForRefresh();
          if (generation !== this.generation) return;
          this.cached = token ? validatedToken(token) : undefined;
          this.loaded = true;
        } catch (error) {
          if (generation !== this.generation) return;
          this.failure = safeFailure(error, 'credential_store_unavailable');
          throw authError(this.failure);
        }
      })();
      const job = task.finally(() => { if (this.loadJob === job) this.loadJob = undefined; });
      this.loadJob = job;
    }
    await this.loadJob;
  }
  private async restore(previous: DeviceToken | undefined, op: Operation): Promise<void> {
    try {
      if (op.invalidatedBy === 'logout' || !previous) await this.store.deleteGithub();
      else await this.store.setGithub(previous);
    } catch {
      this.cached = undefined; this.loaded = true; this.failure = 'credential_store_unavailable';
      throw authError('credential_store_unavailable');
    }
  }
  private async persist(token: DeviceToken, op: Operation): Promise<boolean> {
    return this.serial(async () => {
      if (!this.active(op)) return false;
      const previous = await this.store.getGithubForRefresh();
      if (!this.active(op)) return false;
      try { await this.store.setGithub(token); }
      catch (error) {
        // Readback can fail after a write committed. Restore within this same queue.
        await this.restore(previous, op);
        throw authError(safeFailure(error, 'credential_store_unavailable'));
      }
      if (!this.active(op)) { await this.restore(previous, op); return false; }
      this.cached = token; this.loaded = true; this.failure = undefined;
      return true;
    });
  }

  async start(clientId = this.clientId) {
    if (this.flow || this.refreshJob) throw authError('authorization_pending');
    if (!safeClient(clientId)) throw authError('github_not_configured');
    // Reserve before the first await: simultaneous starts must not produce parallel device flows.
    const op: Operation = { generation: ++this.generation, kind: 'authorization', controller: new AbortController() };
    this.flow = op; this.failure = undefined; this.loadJob = undefined;
    try {
      await this.writes;
      if (!this.active(op)) throw authError('authorization_cancelled');
      const device = this.createDevice(clientId);
      const challenge = await device.start();
      if (!this.active(op)) throw authError('authorization_cancelled');
      if (!safeSecret(challenge.deviceCode) || !/^[A-Za-z0-9-]{1,100}$/.test(challenge.userCode) ||
          challenge.verificationUri !== 'https://github.com/login/device' ||
          !safeTime(challenge.expiresAt) || challenge.expiresAt <= this.now() || challenge.expiresAt > this.now() + 86_400_000 ||
          !Number.isSafeInteger(challenge.interval) || challenge.interval < 1 || challenge.interval > 3600) throw authError('authorization_failed');
      this.clientId = clientId;
      op.challenge = { userCode: challenge.userCode, verificationUri: challenge.verificationUri, expiresAt: challenge.expiresAt };
      void device.poll(challenge.deviceCode, challenge.interval, challenge.expiresAt, { signal: op.controller.signal })
        .then(async value => {
          if (!this.active(op)) return;
          const token = validatedToken(value);
          if (challenge.expiresAt <= this.now() || (token.expiresAt !== undefined && token.expiresAt <= this.now())) throw authError('authorization_expired');
          op.saving = true;
          await this.persist(token, op);
        })
        .catch(error => { if (this.active(op)) this.failure = safeFailure(error, 'authorization_failed'); })
        .finally(() => { if (this.flow === op) this.flow = undefined; });
      return { status: 'pending', ...op.challenge };
    } catch (error) {
      if (this.flow === op) this.flow = undefined;
      if (!this.active(op)) throw authError('authorization_cancelled');
      this.failure = safeFailure(error, 'authorization_failed');
      throw authError(this.failure);
    }
  }

  async status(): Promise<GithubAuthStatus> {
    if (this.flow) {
      if (this.flow.saving) return { status: 'saving' };
      if (this.flow.challenge && this.flow.challenge.expiresAt <= this.now()) {
        const generation = this.flow.generation;
        await this.cancel();
        if (this.generation !== generation + 1) return this.status();
        this.failure = 'authorization_expired';
      } else return { status: 'pending', ...this.flow.challenge };
    }
    if (this.refreshJob) return { status: 'refreshing' };
    await this.writes;
    if (this.failure) return { status: 'failed', code: this.failure };
    try { await this.load(); } catch { return { status: 'failed', code: this.failure ?? 'credential_store_unavailable' }; }
    if (this.flow || this.refreshJob) return this.status();
    if (this.failure) return { status: 'failed', code: this.failure };
    if (this.cached?.expiresAt !== undefined && this.cached.expiresAt <= this.now()) return { status: 'failed', code: 'github_authorization_expired' };
    return this.cached ? { status: 'authorized', expiresAt: this.cached.expiresAt ?? null }
      : { status: safeClient(this.clientId) ? 'signed_out' : 'not_configured' };
  }
  async token(): Promise<string | undefined> {
    await this.load();
    if (this.failure) throw authError(this.failure);
    if (this.flow) throw authError('authorization_pending');
    if (!this.cached) return undefined;
    if (this.cached.expiresAt === undefined || this.cached.expiresAt > this.now() + 30_000) return this.cached.accessToken;
    if (!this.refreshJob) {
      const op: Operation = { generation: this.generation, kind: 'refresh', controller: new AbortController() };
      this.refreshOperation = op;
      const job = this.refresh(op).finally(() => {
        if (this.refreshJob === job) this.refreshJob = undefined;
        if (this.refreshOperation === op) this.refreshOperation = undefined;
      });
      this.refreshJob = job;
    }
    return this.refreshJob;
  }
  private async forget(op: Operation): Promise<void> {
    await this.serial(async () => {
      if (!this.active(op)) return;
      await this.store.deleteGithub();
      this.cached = undefined; this.loaded = true;
    });
  }
  private async refresh(op: Operation): Promise<string | undefined> {
    const current = this.cached;
    if (!current?.refreshToken || !safeClient(this.clientId) ||
        (current.refreshTokenExpiresAt !== undefined && current.refreshTokenExpiresAt <= this.now())) {
      this.failure = 'github_authorization_expired'; throw authError(this.failure);
    }
    try {
      const result = await githubJson('https://github.com/login/oauth/access_token', {
        fetch: (input, init) => this.fetcher(input, { ...init, signal: AbortSignal.any([
          op.controller.signal, ...(init?.signal ? [init.signal] : []),
        ]) }), timeoutMs: 15_000, maxBytes: 65_536, method: 'POST', device: true,
        body: new URLSearchParams({ client_id: this.clientId!, grant_type: 'refresh_token', refresh_token: current.refreshToken }),
      });
      if (!this.active(op)) return undefined;
      if (result?.error) throw authError('github_authorization_expired');
      if (!safeSecret(result?.access_token) || typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer' ||
          !Number.isSafeInteger(result.expires_in) || result.expires_in < 1 || result.expires_in > 31_536_000 ||
          !safeSecret(result.refresh_token) || !Number.isSafeInteger(result.refresh_token_expires_in) ||
          result.refresh_token_expires_in < 1 || result.refresh_token_expires_in > 31_536_000) throw authError('github_refresh_unconfirmed');
      const token = validatedToken({ accessToken: result.access_token, tokenType: 'bearer',
        expiresAt: this.now() + result.expires_in * 1000, refreshToken: result.refresh_token,
        refreshTokenExpiresAt: this.now() + result.refresh_token_expires_in * 1000,
        ...(result.scope !== undefined ? { scope: result.scope } : current.scope !== undefined ? { scope: current.scope } : {}) });
      return await this.persist(token, op) && this.active(op) ? token.accessToken : undefined;
    } catch (error) {
      if (!this.active(op)) return undefined;
      const rejected = error instanceof ConnectorError && error.code === 'github_authorization_expired' ||
        !(error instanceof ConnectorError) && error !== null && typeof error === 'object' && 'status' in error && error.status === 401;
      const code = rejected
        ? 'github_authorization_expired' : 'github_refresh_unconfirmed';
      // A response may be lost after rotation. Remove the old credential so restart cannot blindly
      // repeat that refresh. Recovery is a new explicit authorization, never a network retry loop.
      this.failure = code; this.cached = undefined; this.loaded = true;
      try { await this.forget(op); }
      catch { if (this.active(op)) this.failure = 'credential_store_unavailable'; }
      if (!this.active(op)) return undefined;
      throw authError(this.failure ?? code);
    }
  }

  async cancel() {
    const hadRefresh = Boolean(this.refreshOperation);
    for (const op of [this.flow, this.refreshOperation]) {
      if (op) { op.invalidatedBy = 'cancel'; op.controller.abort(); }
    }
    ++this.generation; this.flow = undefined; this.loadJob = undefined;
    this.refreshJob = undefined; this.refreshOperation = undefined;
    this.cached = undefined; this.loaded = false;
    if (hadRefresh) {
      this.failure = 'github_refresh_unconfirmed'; this.loaded = true;
      try { await this.serial(async () => { await this.store.deleteGithub(); }); }
      catch { this.failure = 'credential_store_unavailable'; throw authError(this.failure); }
    } else { this.failure = undefined; await this.writes; }
    return { cancelled: true };
  }
  async logout() {
    for (const op of [this.flow, this.refreshOperation]) {
      if (op) { op.invalidatedBy = 'logout'; op.controller.abort(); }
    }
    ++this.generation; this.flow = undefined; this.loadJob = undefined;
    this.refreshJob = undefined; this.refreshOperation = undefined;
    this.cached = undefined; this.loaded = true; this.failure = undefined;
    try { await this.serial(async () => { await this.store.deleteGithub(); }); }
    catch { this.failure = 'credential_store_unavailable'; throw authError(this.failure); }
    return { signedOut: true, message: 'Local credentials were removed. Existing GitHub authorization can also be revoked in GitHub settings.' };
  }
}
