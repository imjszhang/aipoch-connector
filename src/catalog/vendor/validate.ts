import { Ajv } from 'ajv';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { actorId, isSafeHttpsUrl, isSafeRelativePath, isSafeRepositoryPath, normalizeGitHubUrl, sourceId } from './identity.js';
import { catalogSchema, COLLECTION_KIND, enhancementSchema, manifestSchema, shardSchema } from './schema.js';
import { COLLECTION_NAMES } from './types.js';
import { relationKindsAllowed } from './relations.js';
import type { CatalogData, CatalogManifest, CatalogRecord, CatalogShard, License, Provenance, SourceRef, ValidationResult } from './types.js';

function isUtcDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
}
const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
ajv.addFormat('utc-date-time', isUtcDate);
ajv.addFormat('safe-https-url', isSafeHttpsUrl);
ajv.addFormat('safe-relative-path', isSafeRelativePath);
ajv.addFormat('safe-repository-path', isSafeRepositoryPath);
const checkCatalog = ajv.compile(catalogSchema);
const checkManifest = ajv.compile(manifestSchema);
const checkShard = ajv.compile(shardSchema);
const checkEnhancement = ajv.compile(enhancementSchema);

function schemaErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}${error.keyword === 'required' ? `: ${String(error.params.missingProperty)}` : ''}`);
}
function validateSchema(check: ValidateFunction, value: unknown): ValidationResult {
  return check(value) ? { ok: true, errors: [] } : { ok: false, errors: schemaErrors(check.errors) };
}
function result(errors: string[]): ValidationResult { return { ok: errors.length === 0, errors }; }

/** Schema plus identity, type, reference, provenance, privacy, and authority constraints. */
export function validateCatalog(input: unknown): ValidationResult {
  const structural = validateSchema(checkCatalog, input);
  if (!structural.ok) return structural;
  const data = input as CatalogData;
  const errors: string[] = [];
  const entities = new Map<string, CatalogRecord>();
  const tombstones = new Map(data.tombstones.map(item => [item.id, item]));
  for (const collection of COLLECTION_NAMES) {
    const seen = new Set<string>();
    for (const item of data[collection]) {
      if (seen.has(item.id)) errors.push(`${collection}: duplicate id ${item.id}`);
      seen.add(item.id);
      if (collection === 'organizations') continue;
      if (entities.has(item.id)) errors.push(`id ${item.id} occurs in multiple collections`);
      entities.set(item.id, item);
      if (collection !== 'tombstones' && tombstones.has(item.id)) errors.push(`active record ${item.id} also has a tombstone`);
    }
  }
  function requireRef(id: string, allowed: string[], at: string): void {
    const target = entities.get(id);
    if (!target) errors.push(`${at}: missing reference ${id}`);
    else if (target.kind !== 'tombstone' && !allowed.includes(target.kind)) errors.push(`${at}: ${id} has the wrong object kind`);
  }
  function evidence(items: Provenance[], at: string): void {
    for (const item of items) {
      if (item.source_id) requireRef(item.source_id, ['source_repository'], at);
      if (item.actor_id) requireRef(item.actor_id, ['actor'], at);
      if (item.path && !item.source_id) errors.push(`${at}: file provenance requires source_id`);
      if (item.commit && !item.source_id) errors.push(`${at}: commit provenance requires source_id`);
    }
  }
  function license(value: License, at: string): void {
    if (value.status === 'unknown' && (value.spdx_id || value.name)) errors.push(`${at}: unknown license cannot declare an identified license`);
    if (value.status === 'identified' && (!(value.spdx_id || value.name) || !value.url)) errors.push(`${at}: identified license requires name/SPDX and source URL`);
  }
  function refs(items: SourceRef[], at: string): void {
    for (const item of items) {
      requireRef(item.source_id, ['source_repository'], at);
      if (item.sha256 && !item.commit && !item.url) errors.push(`${at}: checksum requires a fixed commit or external content URL`);
      if (item.resolved_at && !item.commit) errors.push(`${at}: resolved_at requires a resolved immutable commit`);
    }
  }
  for (const collection of ['sources', 'actors', 'organizations', 'projects', 'resources', 'collections'] as const) {
    for (const item of data[collection]) {
      for (const [field, values] of Object.entries(item.provenance)) evidence(values, `${item.id}.provenance.${field}`);
      if (!item.provenance.title?.length) errors.push(`${item.id}: title must have provenance`);
      if (item.description && !item.provenance.description?.length) errors.push(`${item.id}: description must have provenance`);
    }
  }
  for (const source of data.sources) {
    if (source.id !== sourceId(source.provider_id)) errors.push(`${source.id}: source id must derive only from provider_id`);
    requireRef(source.owner_id, ['actor'], `${source.id}.owner_id`);
    try { if (normalizeGitHubUrl(source.canonical_url).kind !== 'repository') errors.push(`${source.id}: canonical URL must identify a repository`); }
    catch { errors.push(`${source.id}: invalid GitHub canonical URL`); }
    for (const alias of source.aliases) if (alias.provider_id !== source.provider_id) errors.push(`${source.id}: alias identity does not match provider_id`);
    if (source.fork_of) { requireRef(source.fork_of, ['source_repository'], `${source.id}.fork_of`); if (source.fork_of === source.id) errors.push(`${source.id}: repository cannot fork itself`); }
    if (source.availability === 'private') errors.push(`${source.id}: private source must be removed from public records and replaced with a minimal tombstone`);
    if (source.availability === 'temporarily_unavailable' && !source.stale) errors.push(`${source.id}: temporarily unavailable observation must be marked stale`);
    license(source.license, `${source.id}.license`);
  }
  for (const actor of data.actors) {
    if (actor.id !== actorId(actor.provider_id)) errors.push(`${actor.id}: actor id must derive only from provider_id`);
    try { if (normalizeGitHubUrl(actor.canonical_url).kind !== 'organization') errors.push(`${actor.id}: canonical URL must identify a GitHub account`); }
    catch { errors.push(`${actor.id}: invalid GitHub account URL`); }
    for (const alias of actor.aliases) if (alias.provider_id !== actor.provider_id) errors.push(`${actor.id}: alias identity does not match provider_id`);
  }
  for (const org of data.organizations) {
    const actor = data.actors.find(item => item.id === org.actor_id);
    if (org.id !== org.actor_id || actor?.account_type !== 'organization') errors.push(`${org.id}: organization must extend the same organization Actor identity`);
    for (const id of org.source_ids) requireRef(id, ['source_repository'], `${org.id}.source_ids`);
    for (const id of org.resource_ids) requireRef(id, ['resource'], `${org.id}.resource_ids`);
    if (org.participation !== 'community_indexed' && !data.claims.some(claim => claim.subject_id === org.id && claim.type === 'organization_curation' && claim.status === 'verified')) errors.push(`${org.id}: active organization participation requires a separately verified curation claim`);
  }
  for (const project of data.projects) {
    if (!project.id.startsWith('project:')) errors.push(`${project.id}: invalid project identity`);
    refs(project.source_refs, `${project.id}.source_refs`);
    for (const id of project.resource_ids) requireRef(id, ['resource'], `${project.id}.resource_ids`);
  }
  for (const resource of data.resources) {
    if (!resource.id.startsWith('resource:')) errors.push(`${resource.id}: invalid resource identity`);
    refs(resource.source_refs, `${resource.id}.source_refs`);
    for (const id of resource.project_ids) requireRef(id, ['project'], `${resource.id}.project_ids`);
    license(resource.license, `${resource.id}.license`);
    if (resource.runtime.status !== 'not_described' && !resource.runtime.documentation_url) errors.push(`${resource.id}: described runtime requires documentation evidence`);
  }
  for (const collection of data.collections) {
    if (!collection.id.startsWith('collection:')) errors.push(`${collection.id}: invalid collection identity`);
    for (const id of collection.actor_ids) requireRef(id, ['actor'], `${collection.id}.actor_ids`);
    for (const id of collection.item_ids) requireRef(id, ['source_repository', 'actor', 'project', 'resource', 'collection'], `${collection.id}.item_ids`);
  }
  for (const relation of data.relations) {
    if (!relation.id.startsWith('relation:')) errors.push(`${relation.id}: invalid relation identity`);
    requireRef(relation.from_id, ['source_repository', 'actor', 'project', 'resource', 'collection'], `${relation.id}.from_id`);
    requireRef(relation.to_id, ['source_repository', 'actor', 'project', 'resource', 'collection'], `${relation.id}.to_id`);
    if (relation.from_id === relation.to_id) errors.push(`${relation.id}: self-relation is not meaningful`);
    const from = entities.get(relation.from_id);
    const to = entities.get(relation.to_id);
    if (from && to && !relationKindsAllowed(relation.type, from.kind, to.kind)) errors.push(`${relation.id}: relationship type does not match its endpoint kinds`);
    evidence(relation.evidence, relation.id);
  }
  for (const claim of data.claims) {
    if (!claim.id.startsWith('claim:')) errors.push(`${claim.id}: invalid claim identity`);
    requireRef(claim.subject_id, ['source_repository', 'actor', 'project', 'resource', 'collection'], `${claim.id}.subject_id`);
    requireRef(claim.actor_id, ['actor'], `${claim.id}.actor_id`);
    if (claim.verified_by) requireRef(claim.verified_by, ['actor'], `${claim.id}.verified_by`);
    evidence(claim.evidence, claim.id);
    if (claim.status === 'verified') {
      if (!claim.verified_at || !claim.verified_by || !claim.evidence.some(item => item.review === 'reviewed')) errors.push(`${claim.id}: verified claim requires reviewer, time, and reviewed evidence`);
      if (claim.type === 'organization_curation' && !['organization_owner', 'delegated_by_owner'].includes(claim.authority ?? '')) errors.push(`${claim.id}: organization curation requires owner authority or explicit owner delegation`);
      if (claim.type === 'maintainership' && !['repository_maintainer', 'organization_owner', 'delegated_by_owner'].includes(claim.authority ?? '')) errors.push(`${claim.id}: maintainership requires verified authority`);
      if (claim.expires_at && claim.verified_at && Date.parse(claim.expires_at) <= Date.parse(claim.verified_at)) errors.push(`${claim.id}: evidence expiration must follow verification`);
    }
    if (claim.type === 'organization_curation' && !data.actors.some(actor => actor.id === claim.subject_id && actor.account_type === 'organization')) errors.push(`${claim.id}: organization curation must target an organization Actor`);
  }
  for (const tombstone of data.tombstones) {
    if (tombstone.replacement_id) {
      requireRef(tombstone.replacement_id, ['source_repository', 'actor', 'project', 'resource', 'collection'], `${tombstone.id}.replacement_id`);
      if (tombstone.replacement_id === tombstone.id) errors.push(`${tombstone.id}: tombstone cannot replace itself`);
    }
    if (tombstone.status === 'superseded' && !tombstone.replacement_id) errors.push(`${tombstone.id}: superseded tombstone requires replacement_id`);
    let cursor: string | undefined = tombstone.replacement_id;
    const visited = new Set([tombstone.id]);
    while (cursor) {
      if (visited.has(cursor)) { errors.push(`${tombstone.id}: cyclic replacement chain`); break; }
      visited.add(cursor);
      cursor = tombstones.get(cursor)?.replacement_id;
    }
  }
  return result(errors);
}
export function assertValidCatalog(input: unknown): asserts input is CatalogData {
  const checked = validateCatalog(input);
  if (!checked.ok) throw new Error(`Catalog validation failed:\n${checked.errors.join('\n')}`);
}
export function validateManifest(input: unknown): ValidationResult {
  const checked = validateSchema(checkManifest, input);
  if (!checked.ok) return checked;
  const manifest = input as CatalogManifest;
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const name of COLLECTION_NAMES) for (const shard of manifest.collections[name]) {
    if (seen.has(shard.href)) errors.push(`duplicate shard href: ${shard.href}`);
    seen.add(shard.href);
  }
  return result(errors);
}
export function validateShard(input: unknown): ValidationResult {
  const checked = validateSchema(checkShard, input);
  if (!checked.ok) return checked;
  const shard = input as CatalogShard;
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const record of shard.records) {
    if (seen.has(record.id)) errors.push(`duplicate id ${record.id} in ${shard.collection}`);
    seen.add(record.id);
    if (record.kind !== COLLECTION_KIND[shard.collection]) errors.push(`wrong record kind for ${shard.collection}`);
  }
  return result(errors);
}
export function validateEnhancement(input: unknown): ValidationResult {
  const checked = validateSchema(checkEnhancement, input);
  if (!checked.ok) return checked;
  try {
    if (normalizeGitHubUrl((input as {source_url: string}).source_url).kind !== 'repository') return result(['enhancement source_url must identify a GitHub repository']);
  } catch { return result(['enhancement source_url must identify a GitHub repository']); }
  return checked;
}
