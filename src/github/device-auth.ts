import { setTimeout as sleep } from 'node:timers/promises';
import { GithubError, githubJson } from './index.js';
import type { GithubFetch } from './index.js';

export interface DeviceAuthorizationOptions {
  clientId: string; fetch?: GithubFetch; timeoutMs?: number; scopes?: string[];
  now?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
export interface DeviceChallenge { deviceCode: string; userCode: string; verificationUri: string; interval: number; expiresAt: number }
export interface DeviceToken {
  accessToken: string; tokenType: 'bearer'; scope?: string; expiresAt?: number;
  refreshToken?: string; refreshTokenExpiresAt?: number;
}
const safeValue = (value: unknown, max = 4096): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0020\u007f]/.test(value);
/** Device credentials must remain local. This class neither persists nor prints tokens/codes. */
export class DeviceAuthorization {
  private readonly clientId: string; private readonly fetcher: GithubFetch; private readonly timeoutMs: number;
  private readonly scopes: string[]; private readonly now: () => number; private readonly wait: (ms: number, signal?: AbortSignal) => Promise<void>;
  constructor(options: DeviceAuthorizationOptions) {
    if (!options || !/^[A-Za-z0-9_.-]{4,200}$/.test(options.clientId)) throw new GithubError('client_id_required', 'Configure the registered GitHub App client ID before starting device authorization');
    this.clientId = options.clientId; this.fetcher = options.fetch ?? globalThis.fetch; this.timeoutMs = options.timeoutMs ?? 15_000;
    this.scopes = options.scopes ?? []; this.now = options.now ?? Date.now;
    this.wait = options.sleep ?? (async (ms, signal) => { await sleep(ms, undefined, { signal }); });
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.scopes.some(scope => !/^[a-zA-Z0-9:_-]{1,100}$/.test(scope))) throw new GithubError('invalid_options', 'Invalid device authorization options');
  }
  private post(endpoint: 'device/code' | 'oauth/access_token', fields: Record<string, string>, timeoutMs = this.timeoutMs): Promise<any> {
    return githubJson(`https://github.com/login/${endpoint}`, { fetch: this.fetcher, timeoutMs, maxBytes: 65_536, method: 'POST', body: new URLSearchParams(fields), device: true });
  }
  async start(): Promise<DeviceChallenge> {
    const data = await this.post('device/code', { client_id: this.clientId, ...(this.scopes.length ? { scope: this.scopes.join(' ') } : {}) });
    if (data?.error) throw new GithubError('device_unavailable', 'GitHub device authorization is unavailable for this client');
    const interval = data?.interval ?? 5;
    if (!safeValue(data?.device_code) || !safeValue(data?.user_code, 100) || data.verification_uri !== 'https://github.com/login/device' || !Number.isSafeInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 86_400 || !Number.isSafeInteger(interval) || interval < 1 || interval > 3600) throw new GithubError('invalid_response', 'GitHub returned an invalid device challenge');
    return { deviceCode: data.device_code, userCode: data.user_code, verificationUri: data.verification_uri, interval, expiresAt: this.now() + data.expires_in * 1000 };
  }
  async poll(deviceCode: string, interval: number, expiresAt: number, options: { signal?: AbortSignal } = {}): Promise<DeviceToken> {
    if (!safeValue(deviceCode) || !Number.isSafeInteger(interval) || interval < 1 || interval > 3600 || !Number.isFinite(expiresAt) || expiresAt > this.now() + 86_400_000) throw new GithubError('invalid_challenge', 'Invalid device authorization challenge');
    let delay = interval * 1000;
    for (;;) {
      if (options.signal?.aborted) throw new GithubError('authorization_cancelled', 'Stopped waiting for GitHub authorization');
      if (this.now() + delay >= expiresAt) throw new GithubError('authorization_expired', 'GitHub device authorization expired');
      try { await this.wait(delay, options.signal); }
      catch { throw new GithubError('authorization_cancelled', 'Stopped waiting for GitHub authorization'); }
      if (options.signal?.aborted) throw new GithubError('authorization_cancelled', 'Stopped waiting for GitHub authorization');
      const remaining = expiresAt - this.now();
      if (remaining <= 0) throw new GithubError('authorization_expired', 'GitHub device authorization expired');
      const data = await this.post('oauth/access_token', { client_id: this.clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }, Math.min(this.timeoutMs, remaining));
      if (options.signal?.aborted) throw new GithubError('authorization_cancelled', 'Stopped waiting for GitHub authorization');
      if (this.now() >= expiresAt) throw new GithubError('authorization_expired', 'GitHub device authorization expired');
      if (data?.error === 'authorization_pending') continue;
      if (data?.error === 'slow_down') { delay += 5000; continue; }
      if (data?.error === 'access_denied') throw new GithubError('authorization_denied', 'GitHub authorization was declined');
      if (data?.error === 'expired_token') throw new GithubError('authorization_expired', 'GitHub device authorization expired');
      if (data?.error) throw new GithubError('authorization_failed', 'GitHub device authorization could not be completed');
      if (!safeValue(data?.access_token) || data.token_type?.toLowerCase() !== 'bearer' || (data.scope !== undefined && (typeof data.scope !== 'string' || data.scope.length > 4096)) || (data.refresh_token !== undefined && !safeValue(data.refresh_token))) throw new GithubError('invalid_response', 'GitHub returned an invalid authorization result');
      for (const key of ['expires_in', 'refresh_token_expires_in']) if (data[key] !== undefined && (!Number.isSafeInteger(data[key]) || data[key] <= 0 || data[key] > 31_536_000)) throw new GithubError('invalid_response', 'GitHub returned an invalid token lifetime');
      return { accessToken: data.access_token, tokenType: 'bearer', ...(data.scope === undefined ? {} : { scope: data.scope }), ...(data.expires_in === undefined ? {} : { expiresAt: this.now() + data.expires_in * 1000 }), ...(data.refresh_token === undefined ? {} : { refreshToken: data.refresh_token }), ...(data.refresh_token_expires_in === undefined ? {} : { refreshTokenExpiresAt: this.now() + data.refresh_token_expires_in * 1000 }) };
    }
  }
}
