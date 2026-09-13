import type { IntakeCandidate, ResourceType } from './types.js';

export const ID_PATTERN = '^(?:(?:source|actor):github:[1-9][0-9]*|(?:project|resource|collection|relation|claim):[a-z0-9][a-z0-9._-]{0,127})$';
export const FULL_COMMIT_PATTERN = '^[a-f0-9]{40}$';
export const SHA256_PATTERN = '^[a-f0-9]{64}$';
const reservedOwners = new Set(['about', 'apps', 'collections', 'contact', 'customer-stories', 'enterprise', 'events', 'explore', 'features', 'issues', 'join', 'login', 'logout', 'marketplace', 'new', 'notifications', 'organizations', 'pricing', 'pulls', 'search', 'security', 'settings', 'site', 'sponsors', 'topics', 'trending']);

export function sourceId(providerId: number): string {
  assertProviderId(providerId);
  return `source:github:${providerId}`;
}
export function actorId(providerId: number): string {
  assertProviderId(providerId);
  return `actor:github:${providerId}`;
}
function assertProviderId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('GitHub provider_id must be a positive safe integer');
}
/** Supply a persisted opaque key; never derive it afresh from a title, URL or file path. */
export function entityId(kind: 'project' | 'resource' | 'collection' | 'relation' | 'claim', stableKey: string): string {
  const id = `${kind}:${stableKey}`;
  if (!new RegExp(ID_PATTERN).test(id)) throw new Error('Invalid immutable catalog key');
  return id;
}
export function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const credentialQuery = [...url.searchParams.keys()].some(key => /^(?:access_token|token|secret|password|authorization|api_key|client_secret)$/i.test(key));
    return url.protocol === 'https:' && !url.username && !url.password && !credentialQuery && !/[\u0000-\u0020\u007f\\]/.test(value) && !url.port;
  } catch { return false; }
}
/** Validate before URL resolution: URL() silently normalizes traversal and backslashes. */
export function isSafeRelativePath(value: string): boolean {
  if (!value || value.length > 2048 || value.startsWith('/') || /[?#:\\\u0000-\u0020\u007f]/.test(value)) return false;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  if (decoded !== value && /%[a-f0-9]{2}/i.test(decoded)) return false;
  if (/[?#:\\\u0000-\u0020\u007f]/.test(decoded) || decoded.startsWith('/')) return false;
  return decoded.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}
/** Source paths are Git-relative names, not URLs; ordinary spaces need not be renamed. */
export function isSafeRepositoryPath(value: string): boolean {
  if (!value || value.length > 2048 || value.startsWith('/') || /[?#:%\\\u0000-\u001f\u007f]/.test(value)) return false;
  return value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}
export function resolveCatalogHref(fileUrl: string, href: string, catalogRootUrl: string): string {
  if (!isSafeRelativePath(href)) throw new Error('Unsafe catalog relative path');
  const root = new URL(catalogRootUrl);
  const base = new URL(fileUrl);
  if (root.search || root.hash || !root.pathname.endsWith('/') || !['http:', 'https:'].includes(root.protocol) || root.username || root.password) throw new Error('Invalid catalog root');
  const resolved = new URL(href, base);
  if (resolved.origin !== root.origin || !resolved.pathname.startsWith(root.pathname) || resolved.username || resolved.password) throw new Error('Catalog href escapes publication scope');
  return resolved.href;
}
export function normalizeGitHubUrl(input: string): IntakeCandidate {
  const text = input.trim();
  if (!isSafeHttpsUrl(text)) throw new Error('Provide an HTTPS GitHub repository or organization URL without credentials');
  const url = new URL(text);
  if (url.hostname.toLowerCase() !== 'github.com') throw new Error('Only github.com sources are supported in v1');
  // Check the original path before URL() can erase traversal.
  const rawPath = text.slice(text.indexOf('://') + 3).replace(/^[^/]+/, '').split(/[?#]/, 1)[0] ?? '';
  let parts: string[];
  try { parts = rawPath.replace(/^\/+|\/+$/g, '').split('/').map(decodeURIComponent); }
  catch { throw new Error('URL has invalid path encoding'); }
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\/\u0000-\u0020\u007f%]/.test(part))) throw new Error('Invalid GitHub path');
  if (parts[0] === 'orgs') {
    if (parts.length !== 2 && !(parts.length === 3 && parts[2] === 'repositories')) throw new Error('Provide the organization homepage or repositories URL');
    parts = [parts[1]!];
  }
  const owner = parts[0]!.toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(owner) || reservedOwners.has(owner)) throw new Error('Invalid GitHub account name');
  if (parts.length === 1) return { kind: 'organization', provider: 'github', canonical_url: `https://github.com/${owner}`, owner, requires_resolution: true };
  const repository = parts[1]!.replace(/\.git$/i, '').toLowerCase();
  if (!/^[a-z0-9_.-]{1,100}$/.test(repository) || repository === '.' || repository === '..') throw new Error('Invalid GitHub repository name');
  const result: IntakeCandidate = { kind: 'repository', provider: 'github', canonical_url: `https://github.com/${owner}/${repository}`, owner, repository, requires_resolution: true };
  if (parts.length > 2) {
    if ((parts[2] !== 'blob' && parts[2] !== 'tree') || parts.length < 4) throw new Error('Use a repository URL or a blob/tree source location');
    result.location = { type: parts[2], ref_and_path: parts.slice(3).join('/') };
  }
  return result;
}
export function resourceTypeLabel(value: ResourceType): string {
  const labels: Record<string, string> = { tool: 'Tool', method: 'Method', workflow: 'Workflow', skill: 'Skill', dataset: 'Dataset', model: 'Model', reproduction: 'Reproduction', unknown: 'Unclassified' };
  return labels[value] ?? 'Other resource';
}
