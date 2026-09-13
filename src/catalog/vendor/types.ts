/** AIPOCH's independent public catalog. Unknown optional fields may be ignored by v1 readers. */
export const CONTRACT_VERSION = '1.0.0' as const;
export const COLLECTION_NAMES = ['sources', 'actors', 'organizations', 'projects', 'resources', 'collections', 'relations', 'claims', 'tombstones'] as const;
export type CollectionName = typeof COLLECTION_NAMES[number];
export type CatalogStatus = 'candidate' | 'listed';
export type Availability = 'accessible' | 'temporarily_unavailable' | 'unknown' | 'private' | 'deleted';
export type ReviewStatus = 'pending' | 'reviewed' | 'disputed' | 'stale';
export type ProvenanceRole = 'github' | 'community' | 'maintainer' | 'editor' | 'automatic';
export type ResourceType = 'tool' | 'method' | 'workflow' | 'skill' | 'dataset' | 'model' | 'reproduction' | 'unknown' | (string & {});

export interface SourceRef {
  source_id: string;
  role: 'primary' | 'documentation' | 'implementation' | 'data' | 'evidence' | 'related';
  path?: string;
  /** Full immutable Git commit SHA. A branch/tag in ref is never a substitute. */
  commit?: string;
  ref?: string;
  url?: string;
  sha256?: string;
  resolved_at?: string;
}
export interface Provenance {
  role: ProvenanceRole;
  url: string;
  observed_at: string;
  review: ReviewStatus;
  source_id?: string;
  actor_id?: string;
  path?: string;
  commit?: string;
  scope?: string;
  method?: string;
}
export type FieldProvenance = Record<string, Provenance[]>;
export interface Alias {
  url: string;
  verified_at: string;
  provider_id: number;
}
export interface License {
  status: 'unknown' | 'identified' | 'conflicting';
  spdx_id?: string;
  name?: string;
  url?: string;
  path?: string;
  commit?: string;
  conditions?: string;
}
export interface CatalogEntity {
  id: string;
  title: string;
  description?: string;
  status: CatalogStatus;
  updated_at: string;
  provenance: FieldProvenance;
}
export interface SourceRepository extends CatalogEntity {
  kind: 'source_repository';
  provider: 'github';
  provider_id: number;
  canonical_url: string;
  owner_id: string;
  default_branch?: string;
  availability: Availability;
  archived: boolean;
  observed_at: string;
  stale: boolean;
  license: License;
  aliases: Alias[];
  topics?: string[];
  language?: string;
  stars?: number;
  homepage?: string;
  collaboration?: { issues_url?: string; discussions_url?: string };
  readme?: string;
  latest_commit?: string;
  fork_of?: string;
}
export interface Actor extends CatalogEntity {
  kind: 'actor';
  provider: 'github';
  provider_id: number;
  account_type: 'user' | 'organization';
  login: string;
  canonical_url: string;
  aliases: Alias[];
}
/** An extension of an organization Actor; id MUST equal actor_id. */
export interface Organization extends CatalogEntity {
  kind: 'organization';
  actor_id: string;
  source_ids: string[];
  resource_ids: string[];
  participation: 'community_indexed' | 'maintainer_acknowledged' | 'actively_curated';
}
export interface Project extends CatalogEntity {
  kind: 'project';
  question?: string;
  domains: string[];
  source_refs: SourceRef[];
  resource_ids: string[];
}
export interface Resource extends CatalogEntity {
  kind: 'resource';
  resource_type: ResourceType;
  domains: string[];
  source_refs: SourceRef[];
  project_ids: string[];
  license: License;
  documentation_url?: string;
  download_url?: string;
  inputs?: string[];
  outputs?: string[];
  conditions?: string[];
  runtime: { status: 'not_described' | 'maintainer_described' | 'community_described'; documentation_url?: string };
}
export interface Collection extends CatalogEntity {
  kind: 'collection';
  actor_ids: string[];
  item_ids: string[];
  selection_basis: string;
}
export interface Relation {
  kind: 'relation';
  id: string;
  from_id: string;
  to_id: string;
  type: 'uses' | 'produces' | 'references' | 'authored_by' | 'maintained_by' | 'curated_by' | 'fork_of' | 'derived_from' | 'supersedes' | 'split_from';
  evidence: Provenance[];
  recorded_at: string;
  commit?: string;
}
export interface Claim {
  kind: 'claim';
  id: string;
  subject_id: string;
  actor_id: string;
  type: 'maintainership' | 'organization_curation' | 'capability' | 'execution_evidence' | 'scientific_validation';
  status: 'unverified' | 'verified' | 'disputed' | 'revoked' | 'expired';
  scope: string;
  evidence: Provenance[];
  recorded_at: string;
  verified_at?: string;
  expires_at?: string;
  /** Authority is explicit; commits, membership and merges cannot prove owner authority. */
  authority?: 'repository_maintainer' | 'organization_owner' | 'delegated_by_owner';
  verified_by?: string;
  recheck_on: ('transfer' | 'rename' | 'permission_change' | 'evidence_expiry' | 'dispute')[];
}
/** Minimal intentional whitelist: never retain original description or a now-private URL. */
export interface Tombstone {
  kind: 'tombstone';
  id: string;
  status: 'withdrawn' | 'superseded';
  withdrawn_at: string;
  replacement_id?: string;
  reason?: 'withdrawn' | 'unavailable' | 'merged' | 'policy';
}
export interface CatalogData {
  sources: SourceRepository[];
  actors: Actor[];
  organizations: Organization[];
  projects: Project[];
  resources: Resource[];
  collections: Collection[];
  relations: Relation[];
  claims: Claim[];
  tombstones: Tombstone[];
}
export type CatalogRecord = SourceRepository | Actor | Organization | Project | Resource | Collection | Relation | Claim | Tombstone;
export interface ShardDescriptor {
  href: string;
  sha256: string;
  bytes: number;
  count?: number;
}
export interface CatalogManifest {
  contract_version: string;
  snapshot_id: string;
  generated_at: string;
  collections: Record<CollectionName, ShardDescriptor[]>;
}
export interface CatalogShard<T extends CatalogRecord = CatalogRecord> {
  contract_version: string;
  snapshot_id: string;
  collection: CollectionName;
  records: T[];
}
export interface IntakeCandidate {
  kind: 'repository' | 'organization';
  provider: 'github';
  canonical_url: string;
  owner: string;
  repository?: string;
  /** Preserves ambiguous branch/path boundaries until GitHub resolves them. */
  location?: { type: 'blob' | 'tree'; ref_and_path: string };
  requires_resolution: true;
}
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function emptyCatalog(): CatalogData {
  return { sources: [], actors: [], organizations: [], projects: [], resources: [], collections: [], relations: [], claims: [], tombstones: [] };
}
