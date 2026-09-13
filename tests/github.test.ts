import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DeviceAuthorization, GithubClient, GithubError, parseGithubUrl } from '../src/github/index.js';

const commit = 'a'.repeat(40), rootTree = 'b'.repeat(40), docsTree = 'c'.repeat(40);
const bytes = Buffer.from('Example research file\n');
const blobSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const sha256 = createHash('sha256').update(bytes).digest('hex');
function setup() {
  const calls: { url: string; headers: Headers }[] = [];
  const repo = { id: 123, full_name: 'example/research', html_url: 'https://github.com/example/research', default_branch: 'main', license: { spdx_id: 'MIT', name: 'MIT License' } };
  const responses = new Map<string, any>([
    ['/repos/example/research', repo],
    ['/repos/example/research/commits/main', { sha: commit, commit: { tree: { sha: rootTree } } }],
    ['/repos/example/research/commits/feature%2Fstudy', { sha: commit, commit: { tree: { sha: rootTree } } }],
    [`/repos/example/research/commits/${commit}`, { sha: commit, commit: { tree: { sha: rootTree } } }],
    [`/repos/example/research/git/trees/${rootTree}`, { sha: rootTree, truncated: false, tree: [{ path: 'docs', type: 'tree', mode: '040000', sha: docsTree }] }],
    [`/repos/example/research/git/trees/${docsTree}`, { sha: docsTree, truncated: false, tree: [{ path: 'read me.md', type: 'blob', mode: '100644', sha: blobSha, size: bytes.length }] }],
    [`/repos/example/research/git/blobs/${blobSha}`, { sha: blobSha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }],
  ]);
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.redirect, 'manual'); const url = String(input); calls.push({ url, headers: new Headers(init?.headers) });
    const value = responses.get(new URL(url).pathname); return value === undefined ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(value));
  };
  return { responses, calls, repo, fetcher, client: new GithubClient({ fetch: fetcher }) };
}
test('resolves numeric repository identity and longest slash-containing ref, preserving encoded spaces', async () => {
  const { client } = setup(); const source = await client.resolve('https://github.com/example/research/blob/feature/study/docs/read%20me.md');
  assert.equal(source.sourceId, 'source:github:123'); assert.equal(source.commit, commit); assert.equal(source.ref, 'feature/study'); assert.equal(source.path, 'docs/read me.md');
  assert.deepEqual(source.license, { status: 'unknown' }); assert.equal(source.repositoryLicenseObservation?.basis, 'current_repository_metadata');
  const preview = await client.preview(source); assert.equal(preview.sha256, sha256); assert.equal(preview.text, bytes.toString());
  assert.equal((await client.list({ ...source, path: 'docs' }))[0]?.kind, 'file');
});
test('explicit ref/path works for unlisted repositories without a special manifest', async () => {
  const { client } = setup(); const source = await client.resolve('https://github.com/example/research.git', { ref: 'main', path: 'docs/read me.md' });
  assert.equal((await client.getFile(source)).size, bytes.length);
});
test('real GitHub unknown-ref 422 permits path splitting while unrelated validation errors do not', async () => {
  const base = { id: 123, full_name: 'example/research', html_url: 'https://github.com/example/research', default_branch: 'main' };
  const client = new GithubClient({ fetch: async input => {
    const path = new URL(String(input)).pathname;
    if (path === '/repos/example/research') return new Response(JSON.stringify(base));
    if (path.endsWith('/commits/main')) return new Response(JSON.stringify({ sha: commit, commit: { tree: { sha: rootTree } } }));
    return new Response(JSON.stringify({ message: `No commit found for SHA: ${decodeURIComponent(path.split('/commits/')[1]!)}` }), { status: 422 });
  } });
  const source = await client.resolve('https://github.com/example/research/blob/main/README.md');
  assert.equal(source.ref, 'main'); assert.equal(source.path, 'README.md');
  const invalid = new GithubClient({ fetch: async input => new Response(JSON.stringify(String(input).endsWith('/example/research') ? base : { message: 'Validation failed' }), { status: String(input).endsWith('/example/research') ? 200 : 422 }) });
  await assert.rejects(invalid.resolve('https://github.com/example/research/blob/main/README.md'), (error: any) => error.code === 'http_error');
});
test('URL parser rejects credential leaks, traversal and unrelated hosts', () => {
  for (const value of ['https://evil.test/example/research', 'https://token@github.com/example/research', 'https://github.com/example/research?token=secret', 'https://github.com/example/../research', 'https://github.com/example/research/blob/main/%2e%2e/x', 'https://github.com/example/research/blob/main/%252e%252e/x', 'https://github.com/example/research/blob/main/a%2fb', 'https://github.com/example/research/issues/1', 'https://github.com/example/research#readme']) assert.throws(() => parseGithubUrl(value), GithubError);
});
test('file acquisition uses reviewed bytes and creates only a new directory with no executable permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aipoch-github-'));
  try {
    const { client } = setup(); const source = await client.resolve('https://github.com/example/research', { path: 'docs/read me.md' });
    const destination = join(root, 'acquired');
    await assert.rejects(client.materialize(source, destination), (e: any) => e.code === 'confirmation_required');
    await assert.rejects(client.materialize(source, destination, { expectedSha256: 'f'.repeat(64) }), (e: any) => e.code === 'confirmation_changed');
    const receipt = await client.materialize(source, destination, { expectedSha256: sha256 });
    assert.deepEqual(await readFile(receipt.file), bytes); assert.equal((await stat(receipt.file)).mode & 0o777, 0o600);
    await assert.rejects(client.materialize(source, destination, { expectedSha256: sha256 }), (e: any) => e.code === 'destination_exists');
    assert.deepEqual(await readFile(receipt.file), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('repository names cannot silently inherit an old numeric identity', async () => {
  const { client, repo } = setup(); const source = await client.resolve('https://github.com/example/research', { path: 'docs/read me.md' }); repo.id = 999;
  await assert.rejects(client.preview(source), (e: any) => e.code === 'identity_changed');
});
test('rejects symlinks, submodules, truncated trees and changed blob bytes', async () => {
  for (const mode of ['120000', '160000']) {
    const { client, responses } = setup(); const source = await client.resolve('https://github.com/example/research', { path: 'docs/read me.md' });
    responses.get(`/repos/example/research/git/trees/${docsTree}`).tree[0].mode = mode;
    await assert.rejects(client.preview(source), (e: any) => e.code === 'unsupported_file');
  }
  const truncated = setup(); const source = await truncated.client.resolve('https://github.com/example/research', { path: 'docs/read me.md' });
  truncated.responses.get(`/repos/example/research/git/trees/${docsTree}`).truncated = true;
  await assert.rejects(truncated.client.preview(source), (e: any) => e.code === 'invalid_tree');
  const corrupt = setup(); corrupt.responses.get(`/repos/example/research/git/blobs/${blobSha}`).content = Buffer.from('Wrong file contents!!\n').toString('base64');
  await assert.rejects(corrupt.client.preview(source), (e: any) => e.code === 'digest_mismatch');
});
test('only sends explicit token to GitHub API and rejects cross-host redirects', async () => {
  let calls = 0;
  const client = new GithubClient({ token: 'unit-test-secret', fetch: async (_input, init) => { calls++; assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer unit-test-secret'); return new Response('', { status: 301, headers: { location: 'https://evil.test/collect' } }); } });
  await assert.rejects(client.resolve('https://github.com/example/research'), (e: any) => e.code === 'unsafe_redirect' && !e.message.includes('unit-test-secret'));
  assert.equal(calls, 1);
});
test('rate limiting yields a typed delay and never retries automatically', async () => {
  let calls = 0;
  const client = new GithubClient({ fetch: async () => { calls++; return new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '60' } }); } });
  await assert.rejects(client.resolve('https://github.com/example/research'), (e: any) => e.code === 'rate_limited' && e.retryAfterSeconds === 60);
  assert.equal(calls, 1);
});
test('device authorization waits, honors slowdown, and does not send a client secret', async () => {
  let now = 1_000_000; const delays: number[] = []; const outputs = [{ error: 'authorization_pending' }, { error: 'slow_down' }, { access_token: 'test-access-token', token_type: 'bearer', scope: '', expires_in: 3600 }];
  const auth = new DeviceAuthorization({ clientId: 'test-client-id', now: () => now, sleep: async ms => { delays.push(ms); now += ms; }, fetch: async (input, init) => {
    const body = init?.body as URLSearchParams; assert.equal(body.has('client_secret'), false); assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return new Response(JSON.stringify(String(input).endsWith('/device/code') ? { device_code: 'device-code', user_code: 'USER-CODE', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 } : outputs.shift()));
  } });
  const challenge = await auth.start(); const token = await auth.poll(challenge.deviceCode, challenge.interval, challenge.expiresAt);
  assert.equal(token.accessToken, 'test-access-token'); assert.deepEqual(delays, [5000, 5000, 10000]);
});
test('device authorization distinguishes decline, expiry, cancellation and invalid registration', async () => {
  for (const [response, code] of [['access_denied', 'authorization_denied'], ['expired_token', 'authorization_expired']]) {
    const auth = new DeviceAuthorization({ clientId: 'test-client-id', sleep: async () => {}, fetch: async () => new Response(JSON.stringify({ error: response, error_description: 'secret untrusted response' })) });
    await assert.rejects(auth.poll('device-code', 1, Date.now() + 60_000), (e: any) => e.code === code && !e.message.includes('secret'));
  }
  const auth = new DeviceAuthorization({ clientId: 'test-client-id', fetch: async () => { throw new Error('Must not request'); } });
  await assert.rejects(auth.poll('device-code', 1, Date.now() - 1), (e: any) => e.code === 'authorization_expired');
  await assert.rejects(auth.poll('device-code', 1, Date.now() + 60_000, { signal: AbortSignal.abort() }), (e: any) => e.code === 'authorization_cancelled');
  assert.throws(() => new DeviceAuthorization({ clientId: '' }), (e: any) => e.code === 'client_id_required');
});
