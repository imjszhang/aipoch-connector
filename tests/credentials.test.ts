import test from 'node:test';
import assert from 'node:assert/strict';
import { CredentialStore, type CredentialCommand, type CredentialCommandResult } from '../src/credentials.js';
import type { DeviceToken } from '../src/github/device-auth.js';

const TOKEN: DeviceToken = { accessToken: 'ghu_test-access', tokenType: 'bearer', scope: 'read:user',
  expiresAt: 20_000, refreshToken: 'ghr_test-refresh', refreshTokenExpiresAt: 40_000 };
const service = 'network.aipoch.connector.github';
function fakeKeychain() {
  const calls: CredentialCommand[] = [];
  const records = new Map<string, string>();
  const run = async (command: CredentialCommand): Promise<CredentialCommandResult> => {
    calls.push(command);
    assert.equal(command.executable, '/usr/bin/security');
    assert.equal(command.maxOutputBytes, 65_536);
    assert.ok(command.timeoutMs > 0 && command.timeoutMs <= 30_000);
    if (command.args[0] === '-i') {
      assert.deepEqual(command.args, ['-i']);
      const match = command.input?.match(/^add-generic-password -U -a ([a-f0-9]{64}) -s network\.aipoch\.connector\.github -w ([A-Za-z0-9+/]+={0,2})\n$/);
      assert.ok(match, 'only one exact scoped command with base64 data enters stdin');
      records.set(match[1], match[2]);
      return { code: 0, stdout: '', stderr: '' };
    }
    assert.equal(command.input, undefined);
    assert.equal(command.args[1], '-a');
    assert.match(command.args[2], /^[a-f0-9]{64}$/);
    assert.equal(command.args[3], '-s');
    assert.equal(command.args[4], service);
    const key = command.args[2];
    if (command.args[0] === 'find-generic-password') {
      assert.deepEqual(command.args.slice(5), ['-w']);
      return records.has(key) ? { code: 0, stdout: `${records.get(key)}\n`, stderr: '' }
        : { code: 44, stdout: '', stderr: 'Item not found.' };
    }
    assert.equal(command.args[0], 'delete-generic-password');
    return { code: records.delete(key) ? 0 : 44, stdout: '', stderr: '' };
  };
  return { run, calls, records };
}

test('Keychain writes secrets through stdin, verifies them, and never includes them in argv', async () => {
  const keychain = fakeKeychain();
  const store = new CredentialStore('/fixture/connector', { platform: 'darwin', now: () => 10_000, run: keychain.run });
  await store.setGithub(TOKEN);
  assert.deepEqual(await store.getGithub(), TOKEN);
  assert.equal(keychain.calls[0].args.length, 1);
  assert.ok(!JSON.stringify(keychain.calls.map(call => [call.executable, call.args])).includes(TOKEN.accessToken));
  assert.ok(!keychain.calls[0].input?.includes(TOKEN.accessToken));
  assert.ok(!keychain.calls[0].input?.includes(TOKEN.refreshToken!));
  const stored = JSON.parse(Buffer.from([...keychain.records.values()][0], 'base64').toString('utf8'));
  assert.deepEqual(stored, { schemaVersion: 1, token: TOKEN });
});

test('stable data directories select the same item and different directories stay isolated', async () => {
  const keychain = fakeKeychain();
  const dependencies = { platform: 'darwin' as const, now: () => 10_000, run: keychain.run };
  const first = new CredentialStore('/fixture/connector/', dependencies);
  const normalized = new CredentialStore('/fixture/other/../connector', dependencies);
  const other = new CredentialStore('/fixture/other', dependencies);
  await first.setGithub(TOKEN);
  assert.deepEqual(await normalized.getGithub(), TOKEN);
  assert.equal(await other.getGithub(), undefined);
  const secondToken = { accessToken: 'other-access', tokenType: 'bearer' as const };
  await other.setGithub(secondToken);
  await first.deleteGithub();
  assert.equal(await first.getGithub(), undefined);
  assert.deepEqual(await other.getGithub(), secondToken);
});

test('missing credentials return undefined and deleting twice is safe', async () => {
  const keychain = fakeKeychain();
  const store = new CredentialStore('/fixture/connector', { platform: 'darwin', run: keychain.run });
  assert.equal(await store.getGithub(), undefined);
  await store.deleteGithub();
  await store.deleteGithub();
  assert.equal(keychain.records.size, 0);
});

test('expired access tokens are excluded while explicit refresh access preserves the original record', async () => {
  const keychain = fakeKeychain();
  let now = 19_999;
  const store = new CredentialStore('/fixture/connector', { platform: 'darwin', now: () => now, run: keychain.run });
  await store.setGithub(TOKEN);
  assert.deepEqual(await store.getGithub(), TOKEN);
  now = 20_000;
  assert.equal(await store.getGithub(), undefined);
  assert.deepEqual(await store.getGithubForRefresh(), TOKEN);
  now = 45_000;
  assert.equal(await store.getGithub(), undefined);
  assert.deepEqual(await store.getGithubForRefresh(), TOKEN);
});

test('tokens without an expiry remain available until explicitly removed', async () => {
  const keychain = fakeKeychain();
  const store = new CredentialStore('/fixture/connector', { platform: 'darwin', now: () => 99_000, run: keychain.run });
  const token = { accessToken: 'ghp_test-token', tokenType: 'bearer' as const };
  await store.setGithub(token);
  assert.deepEqual(await store.getGithub(), token);
});

test('non-macOS platforms fail explicitly without invoking security or using a file fallback', async () => {
  let calls = 0;
  for (const platform of ['linux', 'win32'] as const) {
    const store = new CredentialStore('/fixture/connector', { platform, run: async () => { calls++; throw new Error('unexpected'); } });
    for (const action of [() => store.getGithub(), () => store.getGithubForRefresh(),
      () => store.setGithub(TOKEN), () => store.deleteGithub()]) {
      await assert.rejects(action(), { code: 'credential_store_unsupported' });
    }
  }
  assert.equal(calls, 0);
});

test('subprocess failures cannot expose credentials through thrown errors', async () => {
  const store = new CredentialStore('/fixture/connector', { platform: 'darwin', run: async () => {
    throw new Error(`secret ${TOKEN.accessToken} ${TOKEN.refreshToken}`);
  } });
  for (const action of [() => store.getGithub(), () => store.setGithub(TOKEN), () => store.deleteGithub()]) {
    await assert.rejects(action(), error => {
      assert.equal((error as { code: string }).code, 'credential_store_unavailable');
      assert.ok(!String(error).includes(TOKEN.accessToken));
      assert.ok(!String(error).includes(TOKEN.refreshToken!));
      assert.equal((error as Error).cause, undefined);
      return true;
    });
  }
});

test('denied or locked Keychain is not treated as an absent credential', async () => {
  const store = new CredentialStore('/fixture/connector', { platform: 'darwin', run: async () => ({
    code: 36, stdout: TOKEN.accessToken, stderr: TOKEN.refreshToken!,
  }) });
  await assert.rejects(store.getGithub(), { code: 'credential_store_unavailable' });
  await assert.rejects(store.setGithub(TOKEN), { code: 'credential_store_unavailable' });
  await assert.rejects(store.deleteGithub(), { code: 'credential_store_unavailable' });
});

test('invalid credential fields are rejected before any system call', async () => {
  let calls = 0;
  const store = new CredentialStore('/fixture/connector', { platform: 'darwin', run: async () => { calls++; throw new Error('unexpected'); } });
  const invalid = [
    { accessToken: '', tokenType: 'bearer' }, { accessToken: 'bad\ntoken', tokenType: 'bearer' },
    { accessToken: 'ok', tokenType: 'Bearer' }, { ...TOKEN, expiresAt: NaN },
    { ...TOKEN, expiresAt: -1 }, { ...TOKEN, refreshToken: 'bad token' },
    { ...TOKEN, scope: 'read:user\nrepo' }, { ...TOKEN, accessToken: 'a'.repeat(4097) },
    { accessToken: 'ok', tokenType: 'bearer', refreshTokenExpiresAt: 20000 },
  ];
  for (const token of invalid) await assert.rejects(store.setGithub(token as DeviceToken), { code: 'credential_invalid' });
  assert.equal(calls, 0);
});

test('untrusted directory/token punctuation cannot inject interactive commands', async () => {
  const keychain = fakeKeychain();
  const store = new CredentialStore('/fixture/";$(aipoch-evil-command)', { platform: 'darwin', run: keychain.run });
  const token: DeviceToken = { accessToken: 'ghp_";$(aipoch-evil-command)#', tokenType: 'bearer' };
  await store.setGithub(token);
  assert.deepEqual(await store.getGithub(), token);
  assert.ok(!keychain.calls[0].input?.includes('aipoch-evil-command'));
  assert.equal(keychain.calls[0].input?.split('\n').length, 2);
});

test('unsupported or malformed stored formats are never used as access tokens', async () => {
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
  for (const output of ['plain-secret-token', '{}', 'AAAA====',
    encoded({ schemaVersion: 2, token: TOKEN }), encoded({ schemaVersion: 1, token: { ...TOKEN, tokenType: 'basic' } }),
    'A'.repeat(32_772)]) {
    const store = new CredentialStore('/fixture/connector', { platform: 'darwin', run: async () => ({ code: 0, stdout: output, stderr: '' }) });
    await assert.rejects(store.getGithub(), { code: 'credential_invalid' });
  }
});

test('write success is not reported if readback returns a different or absent record', async () => {
  for (const result of [{ code: 44, stdout: '', stderr: '' }, { code: 0,
    stdout: Buffer.from(JSON.stringify({ schemaVersion: 1, token: { accessToken: 'other', tokenType: 'bearer' } })).toString('base64'), stderr: '' }]) {
    const store = new CredentialStore('/fixture/connector', { platform: 'darwin', run: async command =>
      command.args[0] === '-i' ? { code: 0, stdout: '', stderr: '' } : result });
    await assert.rejects(store.setGithub(TOKEN), { code: 'credential_write_unconfirmed' });
  }
});

test('subprocess output is bounded even with an injected runner', async () => {
  const store = new CredentialStore('/fixture/connector', { platform: 'darwin', run: async () => ({
    code: 0, stdout: 'x'.repeat(65_537), stderr: '',
  }) });
  await assert.rejects(store.getGithub(), { code: 'credential_store_unavailable' });
});

test('relative or NUL-containing data directories are rejected', () => {
  for (const directory of ['relative', '', '/fixture/\0']) {
    assert.throws(() => new CredentialStore(directory), { code: 'invalid_data_directory' });
  }
});
