import { COLLECTION_NAMES } from './types.js';
import { FULL_COMMIT_PATTERN, ID_PATTERN, SHA256_PATTERN } from './identity.js';

const text = (maxLength = 10000) => ({ type: 'string', minLength: 1, maxLength });
const id = { type: 'string', pattern: ID_PATTERN };
const date = { type: 'string', format: 'utc-date-time' };
const url = { type: 'string', format: 'safe-https-url', maxLength: 4096 };
const path = { type: 'string', format: 'safe-relative-path' };
const repositoryPath = { type: 'string', format: 'safe-repository-path' };
const commit = { type: 'string', pattern: FULL_COMMIT_PATTERN };
const hash = { type: 'string', pattern: SHA256_PATTERN };
const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const providerId = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const enumOf = (...values: string[]) => ({ type: 'string', enum: values });
const arrayOf = (items: unknown, minItems = 0) => ({ type: 'array', items, minItems, maxItems: 100000 });
const ids = { ...arrayOf(id), uniqueItems: true };
const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
const object = (properties: Record<string, unknown>, required: string[] = Object.keys(properties), additionalProperties = true) => ({ type: 'object', properties, required, additionalProperties });
const entityProperties = {
  id, title: text(500), description: text(20000), status: enumOf('candidate', 'listed'),
  updated_at: date, provenance: ref('provenance_map'),
};
const entityRequired = ['kind', 'id', 'title', 'status', 'updated_at', 'provenance'];
const entity = (kind: string, properties: Record<string, unknown>, required: string[]) => object({ ...entityProperties, kind: { const: kind }, ...properties }, [...entityRequired, ...required]);

export const definitions = {
  provenance: object({
    role: enumOf('github', 'community', 'maintainer', 'editor', 'automatic'), url,
    observed_at: date, review: enumOf('pending', 'reviewed', 'disputed', 'stale'),
    source_id: id, actor_id: id, path: repositoryPath, commit, scope: text(1000), method: text(1000),
  }, ['role', 'url', 'observed_at', 'review']),
  provenance_map: { type: 'object', maxProperties: 1000, additionalProperties: arrayOf(ref('provenance'), 1) },
  source_ref: object({ source_id: id, role: enumOf('primary', 'documentation', 'implementation', 'data', 'evidence', 'related'), path: repositoryPath, commit, ref: text(500), url, sha256: hash, resolved_at: date }, ['source_id', 'role']),
  alias: object({ url, verified_at: date, provider_id: providerId }),
  license: object({ status: enumOf('unknown', 'identified', 'conflicting'), spdx_id: text(150), name: text(500), url, path: repositoryPath, commit, conditions: text(5000) }, ['status']),
  source_repository: entity('source_repository', {
    provider: { const: 'github' }, provider_id: providerId, canonical_url: url, owner_id: id,
    default_branch: text(500), availability: enumOf('accessible', 'temporarily_unavailable', 'unknown', 'private', 'deleted'),
    archived: { type: 'boolean' }, observed_at: date, stale: { type: 'boolean' }, license: ref('license'), aliases: arrayOf(ref('alias')),
    topics: { ...arrayOf(text(100)), uniqueItems: true }, language: text(100), stars: count, homepage: url,
    collaboration: object({ issues_url: url, discussions_url: url }, []),
    readme: text(100000), latest_commit: commit, fork_of: id,
  }, ['provider', 'provider_id', 'canonical_url', 'owner_id', 'availability', 'archived', 'observed_at', 'stale', 'license', 'aliases']),
  actor: entity('actor', {
    provider: { const: 'github' }, provider_id: providerId, account_type: enumOf('user', 'organization'),
    login: text(100), canonical_url: url, aliases: arrayOf(ref('alias')),
  }, ['provider', 'provider_id', 'account_type', 'login', 'canonical_url', 'aliases']),
  organization: entity('organization', {
    actor_id: id, source_ids: ids, resource_ids: ids,
    participation: enumOf('community_indexed', 'maintainer_acknowledged', 'actively_curated'),
  }, ['actor_id', 'source_ids', 'resource_ids', 'participation']),
  project: entity('project', {
    question: text(5000), domains: arrayOf(text(100)), source_refs: arrayOf(ref('source_ref'), 1), resource_ids: ids,
  }, ['domains', 'source_refs', 'resource_ids']),
  resource: entity('resource', {
    resource_type: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z][a-z0-9_-]*$' },
    domains: arrayOf(text(100)), source_refs: arrayOf(ref('source_ref'), 1), project_ids: ids, license: ref('license'),
    documentation_url: url, download_url: url, inputs: arrayOf(text(2000)), outputs: arrayOf(text(2000)), conditions: arrayOf(text(2000)),
    runtime: object({ status: enumOf('not_described', 'maintainer_described', 'community_described'), documentation_url: url }, ['status']),
  }, ['resource_type', 'domains', 'source_refs', 'project_ids', 'license', 'runtime']),
  collection: entity('collection', { actor_ids: ids, item_ids: ids, selection_basis: text(5000) }, ['actor_ids', 'item_ids', 'selection_basis']),
  relation: object({
    kind: { const: 'relation' }, id, from_id: id, to_id: id,
    type: enumOf('uses', 'produces', 'references', 'authored_by', 'maintained_by', 'curated_by', 'fork_of', 'derived_from', 'supersedes', 'split_from'),
    evidence: arrayOf(ref('provenance'), 1), recorded_at: date, commit,
  }, ['kind', 'id', 'from_id', 'to_id', 'type', 'evidence', 'recorded_at']),
  claim: object({
    kind: { const: 'claim' }, id, subject_id: id, actor_id: id,
    type: enumOf('maintainership', 'organization_curation', 'capability', 'execution_evidence', 'scientific_validation'),
    status: enumOf('unverified', 'verified', 'disputed', 'revoked', 'expired'), scope: text(2000), evidence: arrayOf(ref('provenance'), 1),
    recorded_at: date, verified_at: date, expires_at: date, authority: enumOf('repository_maintainer', 'organization_owner', 'delegated_by_owner'),
    verified_by: id, recheck_on: { ...arrayOf(enumOf('transfer', 'rename', 'permission_change', 'evidence_expiry', 'dispute'), 1), uniqueItems: true },
  }, ['kind', 'id', 'subject_id', 'actor_id', 'type', 'status', 'scope', 'evidence', 'recorded_at', 'recheck_on']),
  tombstone: object({ kind: { const: 'tombstone' }, id, status: enumOf('withdrawn', 'superseded'), withdrawn_at: date, replacement_id: id, reason: enumOf('withdrawn', 'unavailable', 'merged', 'policy') }, ['kind', 'id', 'status', 'withdrawn_at'], false),
};

export const COLLECTION_KIND = {
  sources: 'source_repository', actors: 'actor', organizations: 'organization', projects: 'project', resources: 'resource', collections: 'collection', relations: 'relation', claims: 'claim', tombstones: 'tombstone',
} as const;

export const catalogSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://aipoch.network/spec/v1/catalog.schema.json',
  title: 'AIPOCH Network v1 catalog collections',
  ...object(Object.fromEntries(COLLECTION_NAMES.map(name => [name, arrayOf(ref(COLLECTION_KIND[name]))]))),
  $defs: definitions,
};
export const manifestSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://aipoch.network/spec/v1/manifest.schema.json',
  title: 'AIPOCH Network v1 snapshot manifest',
  ...object({
    contract_version: { type: 'string', pattern: '^1\\.[0-9]+\\.[0-9]+$' },
    snapshot_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,127}$' },
    generated_at: date,
    collections: object(Object.fromEntries(COLLECTION_NAMES.map(name => [name, arrayOf(object({ href: path, sha256: hash, bytes: count, count }, ['href', 'sha256', 'bytes']))]))),
  }),
};
export const shardSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://aipoch.network/spec/v1/shard.schema.json',
  title: 'AIPOCH Network v1 snapshot shard',
  ...object({ contract_version: manifestSchema.properties.contract_version, snapshot_id: manifestSchema.properties.snapshot_id, collection: enumOf(...COLLECTION_NAMES), records: arrayOf({ oneOf: Object.values(COLLECTION_KIND).map(ref) }) }),
  allOf: COLLECTION_NAMES.map(name => ({ if: { properties: { collection: { const: name } } }, then: { properties: { records: arrayOf(ref(COLLECTION_KIND[name])) } } })),
  $defs: definitions,
};

/** Directory-side enrichment only. Failure never rejects a separately valid URL submission. */
export const enhancementSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://aipoch.network/spec/v1/enhancement.schema.json',
  title: 'Optional AIPOCH Network catalog enrichment',
  ...object({ contract_version: manifestSchema.properties.contract_version, source_url: url, projects: arrayOf(ref('project')), resources: arrayOf(ref('resource')) }, ['contract_version', 'source_url']),
  anyOf: [{ required: ['projects'] }, { required: ['resources'] }],
  $defs: definitions,
};
