import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse as parsePath, resolve as resolvePath } from 'node:path';
import { isSafeRepositoryPath } from '../catalog/vendor/identity.js';
export { DeviceAuthorization } from './device-auth.js';
export type { DeviceAuthorizationOptions, DeviceChallenge, DeviceToken } from './device-auth.js';

export type GithubFetch = typeof globalThis.fetch;
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const API = 'https://api.github.com';
export class GithubError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number, public readonly retryAfterSeconds?: number) { super(message); this.name = 'GithubError'; }
}
function fail(code: string, message: string): never { throw new GithubError(code, message); }
function text(value: unknown, max = 2048): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function safePath(value: unknown): value is string { return typeof value === 'string' && isSafeRepositoryPath(value) && value.split('/').length <= 32; }
function safeRef(value: unknown): value is string { return text(value, 500) && !/[\u0000-\u0020\u007f\\?#:%]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'); }
function safePair(owner: unknown, repo: unknown): owner is string { return typeof owner === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner) && typeof repo === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(repo) && !['.', '..'].includes(repo); }
export interface ParsedGithubUrl { owner: string; repo: string; type: 'repository' | 'tree' | 'blob'; refAndPath?: string }
export function parseGithubUrl(input: string): ParsedGithubUrl {
  if (typeof input !== 'string' || input.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(input)) fail('invalid_url', 'Provide a safe HTTPS GitHub repository URL');
  let url: URL;
  try { url = new URL(input); } catch { return fail('invalid_url', 'Invalid GitHub URL'); }
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash) fail('invalid_url', 'Only github.com HTTPS repository URLs without credentials, query or fragment are supported');
  const rawPath = input.slice(input.indexOf('://') + 3).replace(/^[^/]+/, '');
  let parts: string[];
  try { parts = rawPath.replace(/^\/+|\/+$/g, '').split('/').map(part => decodeURIComponent(part)); }
  catch { return fail('invalid_url', 'Invalid GitHub URL encoding'); }
  if (parts.some(part => !part || part === '.' || part === '..' || /[%\\/\u0000-\u001f\u007f?#:]/.test(part))) fail('invalid_url', 'Unsafe GitHub URL path');
  const owner = parts[0]; const repo = parts[1]?.replace(/\.git$/i, '');
  if (!safePair(owner, repo)) fail('invalid_url', 'Invalid GitHub owner or repository');
  if (parts.length === 2) return { owner: owner!, repo: repo!, type: 'repository' };
  if (!['tree', 'blob'].includes(parts[2]!) || parts.length < 4 || parts.length > 36) fail('invalid_url', 'Use a repository or tree/blob URL');
  return { owner: owner!, repo: repo!, type: parts[2] as 'tree' | 'blob', refAndPath: parts.slice(3).join('/') };
}
function apiUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { return fail('unsafe_redirect', 'Invalid GitHub API URL'); }
  if (url.origin !== API || url.username || url.password || url.hash || /[\u0000-\u0020\u007f\\]/.test(value)) fail('unsafe_redirect', 'GitHub API request cannot leave api.github.com');
  return url;
}
/** Bounded JSON transport; response bodies/credentials are never copied into errors. */
export async function githubJson(url: string, options: { fetch: GithubFetch; token?: string; timeoutMs: number; maxBytes: number; method?: 'GET' | 'POST'; body?: URLSearchParams; device?: boolean }): Promise<any> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new GithubError('timeout', 'GitHub request exceeded its deadline')); }, options.timeoutMs); });
  try {
    return await Promise.race([deadline, (async () => {
      let current = url;
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (options.device) {
          if (!['https://github.com/login/device/code', 'https://github.com/login/oauth/access_token'].includes(current)) fail('unsafe_url', 'Unexpected device authorization endpoint');
        } else apiUrl(current);
        const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'aipoch-connector', 'X-GitHub-Api-Version': '2022-11-28' };
        if (options.device) headers.Accept = 'application/json';
        if (options.token) headers.Authorization = `Bearer ${options.token}`;
        let response: Response;
        try { response = await options.fetch(current, { method: options.method ?? 'GET', headers, ...(options.body ? { body: options.body } : {}), credentials: 'omit', redirect: 'manual', signal: controller.signal }); }
        catch { return fail('request_failed', 'GitHub request failed'); }
        if (response.redirected || (response.url && response.url !== current)) fail('unsafe_redirect', 'Transport unexpectedly followed a redirect');
        if ([301, 302, 307, 308].includes(response.status) && !options.device) {
          const location = response.headers.get('location');
          if (!location || redirects === 3) fail('unsafe_redirect', 'GitHub redirect limit exceeded');
          current = apiUrl(new URL(location, current).href).href;
          void response.body?.cancel().catch(() => {});
          continue;
        }
        if (response.status !== 200) {
          // GitHub uses 422, not 404, for an unknown commit/ref. Accept only the
          // exact bounded error for this endpoint; unrelated 422 errors still fail.
          let unknownRef = false;
          if (response.status === 422 && !options.device && new URL(current).pathname.includes('/commits/') && response.body) {
            const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0;
            try {
              for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16_384) { void reader.cancel().catch(() => {}); break; } chunks.push(Buffer.from(value)); }
              if (size <= 16_384) {
                try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); unknownRef = data.message === `No commit found for SHA: ${decodeURIComponent(new URL(current).pathname.split('/commits/')[1]!)}`; } catch {}
              }
            } finally { reader.releaseLock(); }
          } else void response.body?.cancel().catch(() => {});
          const retry = response.headers.get('retry-after');
          const reset = response.headers.get('x-ratelimit-reset');
          const wait = retry && /^\d+$/.test(retry) ? Number(retry) : reset && /^\d+$/.test(reset) ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1000)) : undefined;
          const limited = response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || retry !== null));
          throw new GithubError(limited ? 'rate_limited' : response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 404 || unknownRef ? 'not_found' : 'http_error', limited ? 'GitHub rate limit reached; retry only after the stated delay' : `GitHub request returned HTTP ${response.status}`, response.status, limited ? wait : undefined);
        }
        const declared = response.headers.get('content-length');
        if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > options.maxBytes)) fail('byte_budget', 'GitHub response exceeds its byte budget');
        if (!response.body) fail('invalid_response', 'GitHub response has no body');
        const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0;
        try {
          for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > options.maxBytes) { void reader.cancel().catch(() => {}); fail('byte_budget', 'GitHub response exceeds its byte budget'); } chunks.push(Buffer.from(value)); }
        } finally { reader.releaseLock(); }
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
        catch { return fail('invalid_response', 'GitHub response is not valid UTF-8 JSON'); }
      }
      return fail('unsafe_redirect', 'GitHub redirect limit exceeded');
    })()]);
  } catch (error) { if (error instanceof GithubError) throw error; return fail('request_failed', 'GitHub response was interrupted'); }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}
export interface ResolvedGithubSource {
  sourceId: string; repositoryId: number; owner: string; repo: string; canonicalUrl: string;
  commit: string; ref: string; path?: string; resolvedAt: string; license: { status: 'unknown' };
  repositoryLicenseObservation?: { spdxId?: string; name?: string; observedAt: string; basis: 'current_repository_metadata' };
}
export interface FilePreview { sourceId: string; repositoryId: number; canonicalUrl: string; commit: string; path: string; blobSha: string; sha256: string; bytes: Buffer; size: number; text?: string }
export interface GithubEntry { name: string; path: string; kind: 'file' | 'directory' | 'symlink' | 'submodule' | 'unsupported'; sha: string; size?: number }
export interface GithubClientOptions { token?: string; fetch?: GithubFetch; timeoutMs?: number; maxFileBytes?: number }
export class GithubClient {
  private readonly fetcher: GithubFetch; private readonly token?: string; private readonly timeoutMs: number; private readonly maxFileBytes: number;
  constructor(options: GithubClientOptions = {}) {
    if (options.token !== undefined && (!text(options.token, 4096) || /[\u0000-\u0020\u007f]/.test(options.token))) fail('invalid_token', 'Invalid explicit GitHub token');
    this.token = options.token; this.fetcher = options.fetch ?? globalThis.fetch; this.timeoutMs = options.timeoutMs ?? 15_000; this.maxFileBytes = options.maxFileBytes ?? 8_388_608;
    if (![this.timeoutMs, this.maxFileBytes].every(n => Number.isSafeInteger(n) && n > 0)) fail('invalid_limits', 'GitHub budgets must be positive safe integers');
  }
  private request(path: string, maxBytes = 8_388_608): Promise<any> { return githubJson(`${API}${path}`, { fetch: this.fetcher, token: this.token, timeoutMs: this.timeoutMs, maxBytes }); }
  private prefix(owner: string, repo: string): string { if (!safePair(owner, repo)) fail('invalid_source', 'Invalid repository identity'); return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`; }
  private async repository(owner: string, repo: string): Promise<any> {
    const data = await this.request(this.prefix(owner, repo));
    const pair = typeof data?.full_name === 'string' ? data.full_name.split('/') : [];
    if (!Number.isSafeInteger(data?.id) || data.id < 1 || pair.length !== 2 || !safePair(pair[0], pair[1]) || data.html_url !== `https://github.com/${pair.join('/')}` || !safeRef(data.default_branch)) fail('invalid_response', 'GitHub returned an invalid repository identity');
    return data;
  }
  private async commit(owner: string, repo: string, ref: string): Promise<{ sha: string; tree: string }> {
    if (!safeRef(ref)) fail('invalid_ref', 'Invalid GitHub ref');
    const result = await this.request(`${this.prefix(owner, repo)}/commits/${encodeURIComponent(ref)}`);
    if (!SHA.test(result?.sha) || !SHA.test(result?.commit?.tree?.sha)) fail('invalid_response', 'GitHub did not return a full commit and tree identity');
    return { sha: result.sha, tree: result.commit.tree.sha };
  }
  async resolve(url: string, options: { ref?: string; path?: string } = {}): Promise<ResolvedGithubSource> {
    const parsed = parseGithubUrl(url); const repo = await this.repository(parsed.owner, parsed.repo);
    const [owner, name] = repo.full_name.split('/') as [string, string];
    if (options.path !== undefined && !safePath(options.path)) fail('invalid_path', 'Unsafe repository path');
    let ref = options.ref ?? repo.default_branch; let path = options.path; let resolved: { sha: string; tree: string } | undefined;
    if (parsed.refAndPath && options.ref !== undefined) fail('ambiguous_source', 'Use a repository URL when providing an explicit ref and path');
    if (parsed.refAndPath) {
      if (options.path !== undefined) fail('ambiguous_source', 'Use the path in the URL or an explicit repository path, not both');
      const parts = parsed.refAndPath.split('/');
      for (let boundary = parts.length; boundary >= 1; boundary--) {
        const candidate = parts.slice(0, boundary).join('/'); if (!safeRef(candidate)) continue;
        try { resolved = await this.commit(owner, name, candidate); ref = candidate; path = parts.slice(boundary).join('/') || undefined; break; }
        catch (error) { if (!(error instanceof GithubError) || !['not_found'].includes(error.code)) throw error; }
      }
      if (!resolved) fail('unresolved_ref', 'No GitHub branch, tag or commit matches this URL');
      if (path && !safePath(path)) fail('invalid_path', 'Unsafe repository path');
      if (parsed.type === 'blob' && !path) fail('invalid_path', 'A blob URL must identify a file');
    }
    resolved ??= await this.commit(owner, name, ref);
    const resolvedAt = new Date().toISOString();
    const observation = repo.license && typeof repo.license === 'object' ? {
      ...(text(repo.license.spdx_id, 150) && repo.license.spdx_id !== 'NOASSERTION' ? { spdxId: repo.license.spdx_id } : {}),
      ...(text(repo.license.name, 500) ? { name: repo.license.name } : {}), observedAt: resolvedAt, basis: 'current_repository_metadata' as const,
    } : undefined;
    return { sourceId: `source:github:${repo.id}`, repositoryId: repo.id, owner, repo: name, canonicalUrl: repo.html_url, commit: resolved.sha, ref, ...(path ? { path } : {}), resolvedAt, license: { status: 'unknown' }, ...(observation ? { repositoryLicenseObservation: observation } : {}) };
  }
  private async tree(prefix: string, sha: string): Promise<any[]> {
    const data = await this.request(`${prefix}/git/trees/${sha}`);
    if (data?.sha !== sha || data.truncated !== false || !Array.isArray(data.tree) || data.tree.length > 100_000) fail('invalid_tree', 'GitHub tree is invalid or truncated');
    const seen = new Set<string>();
    for (const entry of data.tree) {
      if (!text(entry.path) || entry.path.includes('/') || !safePath(entry.path) || seen.has(entry.path) || !SHA.test(entry.sha) || !text(entry.mode, 10) || !text(entry.type, 20) || (entry.size !== undefined && (!Number.isSafeInteger(entry.size) || entry.size < 0))) fail('invalid_tree', 'GitHub tree contains an unsafe or invalid entry');
      seen.add(entry.path);
    }
    return data.tree;
  }
  private async locate(source: ResolvedGithubSource): Promise<{ prefix: string; entry: any }> {
    validateResolvedGithubSource(source);
    const repo = await this.repository(source.owner, source.repo);
    if (repo.id !== source.repositoryId) fail('identity_changed', 'Repository URL no longer identifies the confirmed GitHub repository');
    const [owner, name] = repo.full_name.split('/') as [string, string]; const prefix = this.prefix(owner, name);
    const commit = await this.commit(owner, name, source.commit);
    if (commit.sha !== source.commit) fail('version_changed', 'GitHub did not return the confirmed commit');
    let entry: any = { type: 'tree', mode: '040000', sha: commit.tree, path: '' };
    for (const part of source.path?.split('/') ?? []) {
      if (entry.type !== 'tree' || entry.mode !== '040000') fail('unsupported_file', 'A repository path traverses a symlink, submodule or non-directory');
      const next = (await this.tree(prefix, entry.sha)).find(item => item.path === part);
      if (!next) fail('not_found', 'The selected path does not exist at the confirmed commit'); entry = next;
    }
    return { prefix, entry };
  }
  async list(source: ResolvedGithubSource): Promise<GithubEntry[]> {
    const { prefix, entry } = await this.locate(source);
    if (entry.type !== 'tree' || entry.mode !== '040000') fail('not_directory', 'The selected path is not a directory');
    return (await this.tree(prefix, entry.sha)).map(item => ({ name: item.path, path: source.path ? `${source.path}/${item.path}` : item.path, kind: item.mode === '120000' ? 'symlink' : item.mode === '160000' ? 'submodule' : item.type === 'tree' && item.mode === '040000' ? 'directory' : item.type === 'blob' && ['100644', '100755'].includes(item.mode) ? 'file' : 'unsupported', sha: item.sha, ...(item.size === undefined ? {} : { size: item.size }) }));
  }
  async preview(source: ResolvedGithubSource): Promise<FilePreview> {
    if (!source.path) fail('file_required', 'Select one file before previewing or acquiring contents');
    const { prefix, entry } = await this.locate(source);
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) fail('unsupported_file', 'Only regular files can be acquired; symlinks and submodules are not followed');
    if (entry.size !== undefined && entry.size > this.maxFileBytes) fail('byte_budget', 'Selected file exceeds the configured file budget');
    const blob = await this.request(`${prefix}/git/blobs/${entry.sha}`, Math.ceil(this.maxFileBytes * 1.5) + 65_536);
    if (blob?.sha !== entry.sha || blob.encoding !== 'base64' || typeof blob.content !== 'string' || !Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > this.maxFileBytes) fail('invalid_blob', 'Invalid or oversized GitHub blob');
    const encoded = blob.content.replace(/[\r\n]/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail('invalid_blob', 'Invalid GitHub base64 blob');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length !== blob.size || (entry.size !== undefined && bytes.length !== entry.size) || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== entry.sha) fail('digest_mismatch', 'GitHub blob contents do not match the confirmed tree identity');
    let decoded: string | undefined;
    if (bytes.length <= 262_144 && !bytes.includes(0)) { try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {} }
    return { sourceId: source.sourceId, repositoryId: source.repositoryId, canonicalUrl: source.canonicalUrl, commit: source.commit, path: source.path, blobSha: entry.sha, sha256: createHash('sha256').update(bytes).digest('hex'), bytes, size: bytes.length, ...(decoded === undefined ? {} : { text: decoded }) };
  }
  getFile(source: ResolvedGithubSource): Promise<FilePreview> { return this.preview(source); }
  async materialize(source: ResolvedGithubSource, destination: string, options: { expectedSha256?: string } = {}): Promise<{ status: 'files_acquired'; sourceId: string; commit: string; path: string; sha256: string; bytes: number; destination: string; file: string }> {
    if (!options.expectedSha256 || !HASH.test(options.expectedSha256)) fail('confirmation_required', 'Acquisition requires the SHA-256 of the reviewed file');
    if (!isAbsolute(destination) || /[\u0000-\u001f\u007f]/.test(destination) || resolvePath(destination) !== destination || destination === parsePath(destination).root) fail('invalid_destination', 'Choose a normalized absolute path for a new destination directory');
    const file = await this.preview(source);
    if (file.sha256 !== options.expectedSha256) fail('confirmation_changed', 'File contents do not match the reviewed SHA-256');
    const parent = dirname(destination); const canonicalParent = await realpath(parent);
    // Anchor to the real existing parent. The caller reviews the returned resolved destination.
    const actualDestination = join(canonicalParent, parsePath(destination).base);
    try { await lstat(actualDestination); return fail('destination_exists', 'Destination already exists; existing research files are never overwritten'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await mkdir(actualDestination, { mode: 0o700 });
    let current = actualDestination;
    const parts = file.path.split('/');
    for (const part of parts.slice(0, -1)) { current = join(current, part); await mkdir(current, { mode: 0o700 }); }
    const target = join(current, parts.at(-1)!);
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(file.bytes); await handle.sync(); } finally { await handle.close(); }
    const directory = await open(current, constants.O_RDONLY); try { await directory.sync(); } finally { await directory.close(); }
    return { status: 'files_acquired', sourceId: source.sourceId, commit: source.commit, path: file.path, sha256: file.sha256, bytes: file.size, destination: actualDestination, file: target };
  }
}

export function validateResolvedGithubSource(source: ResolvedGithubSource): void {
  if (!source || !Number.isSafeInteger(source.repositoryId) || source.repositoryId < 1 || source.sourceId !== `source:github:${source.repositoryId}` || !safePair(source.owner, source.repo) || source.canonicalUrl !== `https://github.com/${source.owner}/${source.repo}` || !SHA.test(source.commit) || (source.path !== undefined && !safePath(source.path))) fail('invalid_source', 'Expected a resolved GitHub source with a full commit and safe path');
}
