import { createHash } from 'node:crypto';
import { COLLECTION_NAMES, emptyCatalog } from './vendor/types.js';
import type { CatalogData, CatalogManifest, CatalogRecord, CatalogShard, ValidationResult } from './vendor/types.js';
import { isSafeRelativePath, resolveCatalogHref } from './vendor/identity.js';
import { validateCatalog, validateManifest, validateShard } from './vendor/validate.js';

export type { CatalogData, CatalogManifest, CatalogRecord } from './vendor/types.js';
export const DEFAULT_MANIFEST_URL = 'https://aipoch.network/catalog/v1/manifest.json';
export type Fetcher = typeof globalThis.fetch;
export interface CatalogLimits { manifestBytes: number; shardBytes: number; totalBytes: number; shards: number; records: number; timeoutMs: number }
const DEFAULT_LIMITS: CatalogLimits = { manifestBytes: 1_048_576, shardBytes: 8_388_608, totalBytes: 67_108_864, shards: 4096, records: 100_000, timeoutMs: 15_000 };
export class CatalogError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'CatalogError'; }
}
function fail(code: string, message: string): never { throw new CatalogError(code, message); }
function checked(result: ValidationResult, at: string): void {
  if (!result.ok) fail('invalid_contract', `${at}: ${result.errors.slice(0, 20).join('; ')}`);
}
function entryUrl(value: string): URL {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(value)) fail('invalid_url', 'Invalid catalog manifest URL');
  let url: URL;
  try { url = new URL(value); } catch { return fail('invalid_url', 'Invalid catalog manifest URL'); }
  const local = url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) fail('invalid_url', 'Catalog requires HTTPS or explicit loopback HTTP without credentials, query or fragment');
  const raw = value.replace(/^[a-z]+:\/\/[^/]+/i, '');
  if (!raw.startsWith('/') || !isSafeRelativePath(raw.slice(1))) fail('invalid_url', 'Unsafe manifest path');
  return url;
}
async function fetchBytes(url: string, limit: number, timeoutMs: number, fetcher: Fetcher): Promise<Buffer> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new CatalogError('timeout', 'Catalog request exceeded its deadline')); }, timeoutMs); });
  try {
    return await Promise.race([deadline, (async () => {
      let response: Response;
      try { response = await fetcher(url, { headers: { Accept: 'application/json' }, redirect: 'error', credentials: 'omit', signal: controller.signal }); }
      catch { return fail('request_failed', 'Catalog request failed; no partial or cached snapshot was accepted'); }
      if (response.status !== 200 || response.redirected || (response.url && response.url !== url)) fail('response_rejected', 'Catalog response must be an unredirected HTTP 200');
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) fail('byte_budget', 'Catalog response exceeds byte budget');
      if (!response.body) fail('invalid_body', 'Catalog response has no body');
      const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > limit) { void reader.cancel().catch(() => {}); fail('byte_budget', 'Catalog response exceeds byte budget'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      return Buffer.concat(chunks, size);
    })()]);
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    return fail('request_failed', 'Catalog response was interrupted');
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
}
function parse(bytes: Buffer, at: string): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return fail('invalid_json', `${at} is not valid UTF-8 JSON`); }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
export interface CatalogSnapshot {
  readonly manifest: CatalogManifest;
  readonly collections: CatalogData;
  readonly loadedAt: string;
  get(id: string): CatalogRecord | undefined;
}
export interface CatalogClientOptions { manifestUrl?: string; fetch?: Fetcher; limits?: Partial<CatalogLimits> }
/** Each load/search/get validates one full snapshot. No fallback to stale cached data. */
export class CatalogClient {
  readonly manifestUrl: string;
  private readonly fetcher: Fetcher;
  private readonly limits: CatalogLimits;
  constructor(options: CatalogClientOptions = {}) {
    this.manifestUrl = entryUrl(options.manifestUrl ?? DEFAULT_MANIFEST_URL).href;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value < 1) fail('invalid_limits', 'Catalog budgets must be positive safe integers');
  }
  async load(): Promise<CatalogSnapshot> {
    const { limits } = this;
    const bytes = await fetchBytes(this.manifestUrl, Math.min(limits.manifestBytes, limits.totalBytes), limits.timeoutMs, this.fetcher);
    const manifest = parse(bytes, 'Manifest') as CatalogManifest;
    checked(validateManifest(manifest), 'Manifest');
    const root = new URL('.', this.manifestUrl).href;
    const descriptors: { name: keyof CatalogData; part: CatalogManifest['collections']['sources'][number]; url: string }[] = [];
    const urls = new Set<string>(); let total = bytes.length;
    for (const name of COLLECTION_NAMES) for (const part of manifest.collections[name]) {
      const url = resolveCatalogHref(this.manifestUrl, part.href, root);
      if (urls.has(url)) fail('duplicate_shard', 'Duplicate resolved shard URL'); urls.add(url);
      total += part.bytes;
      if (!Number.isSafeInteger(total) || part.bytes > limits.shardBytes || total > limits.totalBytes || descriptors.length >= limits.shards) fail('download_budget', 'Catalog exceeds its download budget');
      descriptors.push({ name, part, url });
    }
    const data = emptyCatalog(); let count = 0;
    for (const { name, part, url } of descriptors) {
      const content = await fetchBytes(url, Math.min(part.bytes, limits.shardBytes), limits.timeoutMs, this.fetcher);
      if (content.length !== part.bytes) fail('byte_mismatch', 'Shard byte length mismatch');
      if (createHash('sha256').update(content).digest('hex') !== part.sha256) fail('digest_mismatch', 'Shard SHA-256 mismatch');
      const shard = parse(content, 'Shard') as CatalogShard;
      checked(validateShard(shard), 'Shard');
      if (shard.contract_version !== manifest.contract_version || shard.snapshot_id !== manifest.snapshot_id || shard.collection !== name) fail('snapshot_mismatch', 'Shard version, snapshot or collection mismatch');
      if (part.count !== undefined && part.count !== shard.records.length) fail('count_mismatch', 'Shard record count mismatch');
      count += shard.records.length; if (count > limits.records) fail('record_budget', 'Catalog exceeds record budget');
      (data[name] as CatalogRecord[]).push(...shard.records);
    }
    checked(validateCatalog(data), 'Catalog');
    // Upstream structural validation does not compare expiry with this snapshot's date.
    for (const claim of data.claims) if (claim.status === 'verified' && claim.expires_at && Date.parse(claim.expires_at) <= Date.parse(manifest.generated_at)) fail('expired_claim', 'Snapshot contains expired verified evidence');
    const records = new Map<string, CatalogRecord>();
    for (const name of COLLECTION_NAMES) if (name !== 'organizations') for (const record of data[name]) records.set(record.id, record);
    freeze(manifest); freeze(data);
    return Object.freeze({ manifest, collections: data, loadedAt: new Date().toISOString(), get: (id: string) => records.get(id) });
  }
  async search(query: string, options: { limit?: number; kind?: string } = {}): Promise<CatalogRecord[]> {
    if (typeof query !== 'string' || query.length > 1000) fail('invalid_query', 'Search query must contain at most 1000 characters');
    const limit = options.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('invalid_query', 'Search limit must be 1–100');
    const allowed = ['project', 'resource', 'source_repository', 'actor', 'organization', 'collection'];
    if (options.kind && !allowed.includes(options.kind)) fail('invalid_query', 'Unsupported searchable object kind');
    const snapshot = await this.load(); const term = query.normalize('NFKC').toLowerCase();
    const results: CatalogRecord[] = [];
    for (const name of COLLECTION_NAMES) for (const item of snapshot.collections[name]) {
      if (!('title' in item) || item.status !== 'listed' || (options.kind && item.kind !== options.kind)) continue;
      const haystack = `${item.title} ${item.description ?? ''} ${'domains' in item ? item.domains.join(' ') : ''}`.normalize('NFKC').toLowerCase();
      if (!term || haystack.includes(term)) results.push(item);
    }
    return results.slice(0, limit);
  }
  async get(id: string): Promise<CatalogRecord | undefined> { return (await this.load()).get(id); }
}
