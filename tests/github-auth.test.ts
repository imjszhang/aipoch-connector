import test from 'node:test';
import assert from 'node:assert/strict';
import { GithubAuth, type GithubCredentialStore } from '../src/github-auth.js';
import type { DeviceChallenge, DeviceToken, GithubFetch } from '../src/github/index.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const NOW = 100_000;
const fresh: DeviceToken = { accessToken: 'ghu_new', tokenType: 'bearer', expiresAt: NOW + 300_000,
  refreshToken: 'ghr_new', refreshTokenExpiresAt: NOW + 600_000, scope: 'read:user' };
const old: DeviceToken = { accessToken: 'ghu_old', tokenType: 'bearer', expiresAt: NOW - 1,
  refreshToken: 'ghr_old', refreshTokenExpiresAt: NOW + 300_000, scope: 'read:user' };
const challenge = (): DeviceChallenge => ({ deviceCode: 'private-device-code', userCode: 'ABCD-EFGH',
  verificationUri: 'https://github.com/login/device', interval: 1, expiresAt: NOW + 60_000 });
class MemoryStore implements GithubCredentialStore {
  sets: DeviceToken[] = []; deletes = 0; reads = 0;
  constructor(public value?: DeviceToken) {}
  async getGithub() { return this.getGithubForRefresh(); }
  async getGithubForRefresh() { this.reads++; return this.value ? { ...this.value } : undefined; }
  async setGithub(token: DeviceToken) { this.sets.push({ ...token }); this.value = { ...token }; }
  async deleteGithub() { this.deletes++; this.value = undefined; }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(auth: GithubAuth, expected: string) {
  for (let i = 0; i < 20; i++) {
    const status = await auth.status();
    if (status.status === expected) return status;
    await tick();
  }
  assert.fail(`Authorization did not reach ${expected}`);
}
function deviceAuth(store: MemoryStore, grant = deferred<DeviceToken>(), start = async () => challenge()) {
  const auth = new GithubAuth(store, 'Iv1.fixture', () => NOW, { createDevice: () => ({ start, poll: () => grant.promise }) });
  return { auth, grant };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'content-type': 'application/json' } });
const refreshed = () => ({ access_token: 'ghu_rotated', token_type: 'bearer', expires_in: 3600,
  refresh_token: 'ghr_rotated', refresh_token_expires_in: 7200 });

test('device flow status exposes only the verification challenge and authorizes after durable storage', async () => {
  const store = new MemoryStore();
  const { auth, grant } = deviceAuth(store);
  const started = await auth.start();
  assert.equal(started.status, 'pending');
  assert.ok(!JSON.stringify(started).includes(challenge().deviceCode));
  grant.resolve(fresh);
  const status = await until(auth, 'authorized');
  assert.equal(await auth.token(), fresh.accessToken);
  assert.equal(store.sets.length, 1);
  assert.ok(!JSON.stringify(status).includes(fresh.accessToken));
  assert.ok(!JSON.stringify(status).includes(fresh.refreshToken!));
});

test('simultaneous starts reserve one flow before the initial network request resolves', async () => {
  const challengeJob = deferred<DeviceChallenge>();
  let starts = 0;
  const { auth } = deviceAuth(new MemoryStore(), deferred(), async () => { starts++; return challengeJob.promise; });
  const first = auth.start();
  await assert.rejects(auth.start(), { code: 'authorization_pending' });
  challengeJob.resolve(challenge());
  await first;
  assert.equal(starts, 1);
  await auth.cancel();
});

test('cancel while obtaining a challenge prevents the late challenge from starting polling', async () => {
  const challengeJob = deferred<DeviceChallenge>();
  let polls = 0;
  const auth = new GithubAuth(new MemoryStore(), 'Iv1.fixture', () => NOW, { createDevice: () => ({
    start: () => challengeJob.promise, poll: async () => { polls++; return fresh; },
  }) });
  const started = auth.start();
  await tick();
  await auth.cancel();
  challengeJob.resolve(challenge());
  await assert.rejects(started, { code: 'authorization_cancelled' });
  assert.equal(polls, 0);
  assert.deepEqual(await auth.status(), { status: 'signed_out' });
});

test('logout followed by a late device grant cannot restore credentials', async () => {
  const store = new MemoryStore();
  const { auth, grant } = deviceAuth(store);
  await auth.start();
  await auth.logout();
  grant.resolve(fresh);
  await tick();
  assert.equal(store.value, undefined);
  assert.equal(store.sets.length, 0);
  assert.deepEqual(await auth.status(), { status: 'signed_out' });
  assert.equal(await auth.token(), undefined);
});

test('logout waits for an already-started Keychain write and removes its late value', async () => {
  const store = new MemoryStore();
  const entered = deferred<void>(), release = deferred<void>();
  const set = store.setGithub.bind(store);
  store.setGithub = async token => { entered.resolve(); await release.promise; await set(token); };
  const { auth, grant } = deviceAuth(store);
  await auth.start(); grant.resolve(fresh); await entered.promise;
  assert.deepEqual(await auth.status(), { status: 'saving' });
  const loggedOut = auth.logout();
  release.resolve(); await loggedOut; await tick();
  assert.equal(store.value, undefined);
  assert.deepEqual(await auth.status(), { status: 'signed_out' });
  assert.equal(await auth.token(), undefined);
});

test('cancel during a replacement Keychain write restores the previously authorized record', async () => {
  const previous = { ...fresh, accessToken: 'ghu_previous' };
  const store = new MemoryStore(previous);
  const entered = deferred<void>(), release = deferred<void>();
  const set = store.setGithub.bind(store);
  store.setGithub = async token => { if (token.accessToken === fresh.accessToken) { entered.resolve(); await release.promise; } await set(token); };
  const { auth, grant } = deviceAuth(store);
  await auth.start(); grant.resolve(fresh); await entered.promise;
  const cancelled = auth.cancel(); release.resolve(); await cancelled; await tick();
  assert.deepEqual(store.value, previous);
  assert.equal(await auth.token(), previous.accessToken);
});

test('cancel then a new flow rejects the old late grant without clearing the new flow', async () => {
  const store = new MemoryStore();
  const first = deferred<DeviceToken>(), second = deferred<DeviceToken>();
  let flows = 0;
  const auth = new GithubAuth(store, 'Iv1.fixture', () => NOW, { createDevice: () => {
    const grant = flows++ === 0 ? first : second;
    return { start: async () => challenge(), poll: () => grant.promise };
  } });
  await auth.start(); await auth.cancel(); await auth.start();
  first.resolve({ ...fresh, accessToken: 'ghu_stale' }); await tick();
  assert.equal((await auth.status()).status, 'pending');
  second.resolve(fresh); await until(auth, 'authorized');
  assert.equal(await auth.token(), fresh.accessToken);
  assert.equal(store.sets.length, 1);
});

test('concurrent token requests share one refresh and publish only its verified rotated credential', async () => {
  const store = new MemoryStore(old);
  const network = deferred<Response>();
  let requests = 0;
  const fetcher: GithubFetch = async (url, init) => {
    requests++;
    assert.equal(String(url), 'https://github.com/login/oauth/access_token');
    const body = new URLSearchParams(String(init?.body));
    assert.deepEqual([...body.keys()].sort(), ['client_id', 'grant_type', 'refresh_token']);
    assert.equal(body.get('client_id'), 'Iv1.fixture');
    assert.equal(body.get('refresh_token'), old.refreshToken);
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    return network.promise;
  };
  const auth = new GithubAuth(store, 'Iv1.fixture', () => NOW, { fetch: fetcher });
  const first = auth.token(), second = auth.token(); await tick();
  assert.equal(requests, 1);
  assert.deepEqual(await auth.status(), { status: 'refreshing' });
  network.resolve(response(refreshed()));
  assert.deepEqual(await Promise.all([first, second]), ['ghu_rotated', 'ghu_rotated']);
  assert.equal(store.sets.length, 1);
  assert.equal(store.value?.refreshToken, 'ghr_rotated');
  assert.equal(store.value?.scope, 'read:user');
  assert.equal(await auth.token(), 'ghu_rotated');
  assert.equal(requests, 1);
});

test('expired refresh tokens never cause an HTTP request or an authorized status', async () => {
  let requests = 0;
  const store = new MemoryStore({ ...old, refreshTokenExpiresAt: NOW });
  const auth = new GithubAuth(store, 'Iv1.fixture', () => NOW, { fetch: async () => { requests++; return response(refreshed()); } });
  assert.deepEqual(await auth.status(), { status: 'failed', code: 'github_authorization_expired' });
  await assert.rejects(auth.token(), { code: 'github_authorization_expired' });
  await assert.rejects(auth.token(), { code: 'github_authorization_expired' });
  assert.equal(requests, 0);
});

test('a rejected or uncertain refresh is quarantined and not retried, including after restart', async () => {
  for (const mode of ['revoked', 'unauthorized', 'transport', 'malformed', 'http'] as const) {
    let requests = 0;
    const store = new MemoryStore(old);
    const fetcher: GithubFetch = async () => {
      requests++;
      if (mode === 'transport') throw new Error(`sensitive ${old.refreshToken}`);
      if (mode === 'revoked') return response({ error: 'bad_refresh_token', error_description: old.refreshToken });
      if (mode === 'unauthorized') return response({ message: old.refreshToken }, 401);
      if (mode === 'malformed') return response({ ...refreshed(), expires_in: -1 });
      return response({ message: old.refreshToken }, 503);
    };
    const auth = new GithubAuth(store, 'Iv1.fixture', () => NOW, { fetch: fetcher });
    const expected = mode === 'revoked' || mode === 'unauthorized' ? 'github_authorization_expired' : 'github_refresh_unconfirmed';
    await assert.rejects(auth.token(), error => {
      assert.equal((error as { code: string }).code, expected);
      assert.ok(!String(error).includes(old.refreshToken!)); return true;
    });
    await assert.rejects(auth.token(), { code: expected });
    assert.deepEqual(await auth.status(), { status: 'failed', code: expected });
    assert.equal(store.value, undefined);
    assert.equal(await new GithubAuth(store, 'Iv1.fixture', () => NOW, { fetch: fetcher }).token(), undefined);
    assert.equal(requests, 1);
  }
});

test('logout during refresh ignores a late HTTP response and allows a fresh device flow', async () => {
  const store = new MemoryStore(old), network = deferred<Response>(), grant = deferred<DeviceToken>();
  const auth = new GithubAuth(store, 'Iv1.fixture', () => NOW, { fetch: async () => network.promise,
    createDevice: () => ({ start: async () => challenge(), poll: () => grant.promise }) });
  const pending = auth.token(); await tick(); await auth.logout();
  assert.deepEqual(await auth.status(), { status: 'signed_out' });
  await auth.start(); network.resolve(response(refreshed()));
  assert.equal(await pending, undefined);
  assert.equal((await auth.status()).status, 'pending');
  grant.resolve(fresh); await until(auth, 'authorized');
  assert.equal(await auth.token(), fresh.accessToken);
  assert.equal(store.sets.length, 1);
});

test('logout during rotated-token persistence removes the late Keychain value', async () => {
  const store = new MemoryStore(old), entered = deferred<void>(), release = deferred<void>();
  const set = store.setGithub.bind(store);
  store.setGithub = async token => { entered.resolve(); await release.promise; await set(token); };
  const auth = new GithubAuth(store, 'Iv1.fixture', () => NOW, { fetch: async () => response(refreshed()) });
  const pending = auth.token(); await entered.promise;
  const loggedOut = auth.logout(); release.resolve();
  await loggedOut; assert.equal(await pending, undefined);
  assert.equal(store.value, undefined);
  assert.deepEqual(await auth.status(), { status: 'signed_out' });
});

test('logout during failed-refresh cleanup supersedes its late failure state', async () => {
  const store = new MemoryStore(old), entered = deferred<void>(), release = deferred<void>();
  const remove = store.deleteGithub.bind(store);
  let deletes = 0;
  store.deleteGithub = async () => { if (++deletes === 1) { entered.resolve(); await release.promise; } await remove(); };
  const auth = new GithubAuth(store, 'Iv1.fixture', () => NOW, { fetch: async () => response({}, 503) });
  const pending = auth.token(); await entered.promise;
  const loggedOut = auth.logout(); release.resolve();
  await loggedOut; assert.equal(await pending, undefined);
  assert.deepEqual(await auth.status(), { status: 'signed_out' });
});

test('cancel during refresh removes a potentially rotated old credential without automatically repeating', async () => {
  const store = new MemoryStore(old), network = deferred<Response>();
  let requests = 0;
  const auth = new GithubAuth(store, 'Iv1.fixture', () => NOW, { fetch: async () => { requests++; return network.promise; } });
  const pending = auth.token(); await tick(); await auth.cancel();
  network.resolve(response(refreshed()));
  assert.equal(await pending, undefined);
  assert.equal(store.value, undefined);
  await assert.rejects(auth.token(), { code: 'github_refresh_unconfirmed' });
  assert.equal(requests, 1);
});

test('a late credential load cannot repopulate memory after logout', async () => {
  const loaded = deferred<DeviceToken | undefined>(), store = new MemoryStore(fresh);
  store.getGithubForRefresh = () => loaded.promise;
  const auth = new GithubAuth(store, 'Iv1.fixture', () => NOW);
  const token = auth.token(); await tick(); await auth.logout(); loaded.resolve(fresh);
  assert.equal(await token, undefined);
  assert.deepEqual(await auth.status(), { status: 'signed_out' });
});

test('failed protected deletion is not reported as signed out or allowed to reuse cached authorization', async () => {
  const store = new MemoryStore(fresh);
  const auth = new GithubAuth(store, 'Iv1.fixture', () => NOW);
  assert.equal(await auth.token(), fresh.accessToken);
  store.deleteGithub = async () => { throw new Error(fresh.accessToken); };
  await assert.rejects(auth.logout(), { code: 'credential_store_unavailable' });
  assert.deepEqual(await auth.status(), { status: 'failed', code: 'credential_store_unavailable' });
  await assert.rejects(auth.token(), { code: 'credential_store_unavailable' });
});

test('failed Keychain readback restores the old value and never reports the new grant authorized', async () => {
  const previous = { ...fresh, accessToken: 'ghu_previous' }, store = new MemoryStore(previous);
  const set = store.setGithub.bind(store);
  store.setGithub = async token => { await set(token); if (token.accessToken === fresh.accessToken) throw new Error(fresh.refreshToken); };
  const { auth, grant } = deviceAuth(store); await auth.start(); grant.resolve(fresh);
  const status = await until(auth, 'failed');
  assert.equal(status.status, 'failed'); assert.deepEqual(store.value, previous);
  assert.ok(!JSON.stringify(status).includes(fresh.refreshToken!));
});

test('client IDs and device errors are bounded and cannot inject secrets into public status', async () => {
  let requests = 0;
  const store = new MemoryStore();
  for (const clientId of ['', 'x\nclient_secret=secret', 'https://github.com', { client_secret: 'secret' }]) {
    const auth = new GithubAuth(store, undefined, () => NOW, { fetch: async () => { requests++; return response({}); } });
    await assert.rejects(auth.start(clientId as string), { code: 'github_not_configured' });
  }
  assert.equal(requests, 0);
  const grant = deferred<DeviceToken>(), { auth } = deviceAuth(store, grant);
  await auth.start(); grant.reject({ code: `private-${fresh.accessToken}`, message: fresh.refreshToken });
  assert.deepEqual(await until(auth, 'failed'), { status: 'failed', code: 'authorization_failed' });
});

test('an expired device challenge cannot stay pending indefinitely', async () => {
  let now = NOW;
  const grant = deferred<DeviceToken>(), store = new MemoryStore();
  const auth = new GithubAuth(store, 'Iv1.fixture', () => now, { createDevice: () => ({
    start: async () => challenge(), poll: () => grant.promise,
  }) });
  await auth.start(); now = NOW + 60_000;
  assert.deepEqual(await auth.status(), { status: 'failed', code: 'authorization_expired' });
  grant.resolve(fresh); await tick(); assert.equal(store.value, undefined);
});
