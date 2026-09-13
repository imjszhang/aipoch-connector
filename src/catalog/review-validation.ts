import { isDeepStrictEqual } from 'node:util';
import { ConnectorError, parseResearchReview, parseSubmission, type ResearchReview, type Submission } from '../contracts.js';
import { isSafeHttpsUrl } from './vendor/identity.js';
import type { CatalogClient, CatalogSnapshot } from './index.js';

export interface ReviewValidationOptions { publicBase?: string }
/** This adapter is pinned to the exact v9-r2 review format; catalog v1 remains extensible. */
export function expectedCatalogReview(snapshot: CatalogSnapshot, objectId: string, options: ReviewValidationOptions = {}): ResearchReview {
  const entry = snapshot.get(objectId);
  if (!entry || !['project', 'resource'].includes(entry.kind) || !('source_refs' in entry) || entry.status !== 'listed' || snapshot.collections.tombstones.some(row => row.id === objectId))
    throw new ConnectorError('reference_unavailable', 'This object is not currently listed. Review the current directory.', 409);
  if (entry.source_refs.length === 0) throw new ConnectorError('source_unavailable', 'The current reference has no complete sources.', 409);
  const base = options.publicBase ?? 'https://aipoch.network';
  if (!isSafeHttpsUrl(base) || new URL(base).search || new URL(base).hash)
    throw new ConnectorError('invalid_public_base', 'The configured public Network location must be an HTTPS publication base.');
  const sources = entry.source_refs.map(ref => {
    const source = snapshot.collections.sources.find(row => row.id === ref.source_id);
    if (!source || source.status !== 'listed' || ['private', 'deleted'].includes(source.availability) || snapshot.collections.tombstones.some(row => row.id === ref.source_id))
      throw new ConnectorError('source_unavailable', 'A required source is withdrawn, unlisted or no longer public. Review the current directory.', 409);
    return {
      id: ref.source_id, role: ref.role, url: source.canonical_url, reference_url: ref.url ?? null,
      commit: ref.commit ?? null, named_reference: ref.ref ?? null, path: ref.path ?? null,
      version_status: ref.commit ? 'fixed' as const : 'unfixed' as const,
      path_status: ref.path === undefined ? 'not_supplied' as const : 'provided' as const,
      sha256: ref.sha256 ?? null, resolved_at: ref.resolved_at ?? null,
      availability: source.availability as 'accessible' | 'temporarily_unavailable' | 'unknown',
      archived: source.archived, stale: source.stale, observed_at: source.observed_at,
      license: { ...structuredClone(source.license) },
    };
  });
  return {
    format: 'aipoch-network-internal-review-1',
    object: { id: entry.id, kind: entry.kind, title: entry.title },
    action: entry.kind === 'project' ? 'Open' : 'Use', target: 'Open-Science',
    public_location: `${base.replace(/\/$/, '')}/${entry.kind === 'project' ? 'projects' : 'capabilities'}/${entry.id.replaceAll(':', '~')}/`,
    snapshot: { id: snapshot.manifest.snapshot_id, generated_at: snapshot.manifest.generated_at },
    sources,
    license: entry.kind === 'resource' ? { ...structuredClone(entry.license) } : { status: 'per_source', conditions: 'Each source retains its own license and conditions.' },
    conditions: entry.kind === 'resource' ? [...(entry.conditions ?? [])] : [],
  };
}

/** Validate the full, ordered source projection, never merely IDs mentioned by the sender. */
export function validateReviewAgainstCatalog(input: Submission, snapshot: CatalogSnapshot, options: ReviewValidationOptions = {}): ResearchReview {
  const submission = parseSubmission(input);
  const review = parseResearchReview(submission.review.content);
  if (review.snapshot.id !== snapshot.manifest.snapshot_id || review.snapshot.generated_at !== snapshot.manifest.generated_at)
    throw new ConnectorError('catalog_changed', 'The directory snapshot changed. Refresh and review the object again.', 409);
  const expected = expectedCatalogReview(snapshot, submission.objectId, options);
  if (!isDeepStrictEqual(review, expected))
    throw new ConnectorError('reference_changed', 'The complete reviewed object, sources, versions, licenses or conditions differ from the current directory. Review the current reference again.', 409);
  return review;
}

/** Integration seam: pass this as ConnectorCore's reference guard for newly received requests. */
export function createCatalogReviewGuard(catalog: Pick<CatalogClient, 'load'>, options: ReviewValidationOptions = {}): (submission: Submission) => Promise<void> {
  return async submission => { validateReviewAgainstCatalog(submission, await catalog.load(), options); };
}
