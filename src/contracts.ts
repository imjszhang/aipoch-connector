import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isSafeHttpsUrl, isSafeRepositoryPath } from './catalog/vendor/identity.js';

export const PROTOCOL_VERSION = '1.0' as const;
export const DEFAULT_PORT = 47821;
export const PAIRING_TTL = 180_000;
export const SESSION_TTL = 30 * 60_000;
export const MAX_BODY_BYTES = 256 * 1024;
export const digest = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
const identifier = z.string().min(1).max(200).regex(/^[a-zA-Z0-9:._-]+$/);
const boundedText = (maximum: number) => z.string().min(1).max(maximum);
const fullCommit = z.string().regex(/^[a-f0-9]{40}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const safeUrl = boundedText(4096).refine(isSafeHttpsUrl);
const repositoryPath = boundedText(2048).refine(isSafeRepositoryPath);
const utcDate = z.string().max(24).refine(value => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
});
// License objects inherit the catalog's optional-field extension policy. The catalog guard
// compares every supplied field with the trusted source, including any future optional field.
export const reviewLicenseSchema = z.object({
  status: z.enum(['unknown', 'identified', 'conflicting']), spdx_id: boundedText(150).optional(),
  name: boundedText(500).optional(), url: safeUrl.optional(), path: repositoryPath.optional(),
  commit: fullCommit.optional(), conditions: boundedText(5000).optional(),
}).passthrough().superRefine((value, context) => {
  if (value.status === 'unknown' && (value.spdx_id || value.name)) context.addIssue({ code: 'custom', message: 'Unknown license cannot identify a license.' });
  if (value.status === 'identified' && (!(value.spdx_id || value.name) || !value.url)) context.addIssue({ code: 'custom', message: 'Identified license needs an identity and source URL.' });
});
const reviewedSourceSchema = z.object({
  id: z.string().max(200).regex(/^source:github:[1-9][0-9]*$/),
  role: z.enum(['primary', 'documentation', 'implementation', 'data', 'evidence', 'related']),
  url: safeUrl, reference_url: safeUrl.nullable(), commit: fullCommit.nullable(),
  named_reference: boundedText(500).nullable(), path: repositoryPath.nullable(),
  version_status: z.enum(['fixed', 'unfixed']), path_status: z.enum(['provided', 'not_supplied']),
  sha256: sha256.nullable(), resolved_at: utcDate.nullable(),
  availability: z.enum(['accessible', 'temporarily_unavailable', 'unknown']),
  archived: z.boolean(), stale: z.boolean(), observed_at: utcDate,
  license: reviewLicenseSchema,
}).strict().superRefine((value, context) => {
  if (value.version_status !== (value.commit ? 'fixed' : 'unfixed')) context.addIssue({ code: 'custom', message: 'Version status must reflect the reviewed commit.' });
  if (value.path_status !== (value.path === null ? 'not_supplied' : 'provided')) context.addIssue({ code: 'custom', message: 'Path status must reflect the reviewed path.' });
  if (value.sha256 && !value.commit && !value.reference_url) context.addIssue({ code: 'custom', message: 'Checksum requires a commit or content URL.' });
  if (value.resolved_at && !value.commit) context.addIssue({ code: 'custom', message: 'Resolution time requires a resolved commit.' });
  if (value.availability === 'temporarily_unavailable' && !value.stale) context.addIssue({ code: 'custom', message: 'Temporarily unavailable sources must be marked stale.' });
});
export const researchReviewSchema = z.object({
  format: z.literal('aipoch-network-internal-review-1'),
  object: z.object({ id: z.string().regex(/^(?:project|resource):[a-z0-9][a-z0-9._-]{0,127}$/), kind: z.enum(['project', 'resource']), title: boundedText(500) }).strict(),
  action: z.enum(['Open', 'Use']), target: z.literal('Open-Science'), public_location: safeUrl,
  snapshot: z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/), generated_at: utcDate }).strict(),
  sources: z.array(reviewedSourceSchema).min(1).max(100_000),
  license: z.union([reviewLicenseSchema, z.object({ status: z.literal('per_source'), conditions: boundedText(5000) }).strict()]),
  conditions: z.array(boundedText(2000)).max(100_000),
}).strict().superRefine((value, context) => {
  if (!value.object.id.startsWith(`${value.object.kind}:`) || value.action !== (value.object.kind === 'project' ? 'Open' : 'Use')) context.addIssue({ code: 'custom', message: 'Object identity and action must match its kind.' });
  if ((value.object.kind === 'project') !== (value.license.status === 'per_source')) context.addIssue({ code: 'custom', message: 'Projects retain per-source licenses; resources retain their stated license.' });
});
export type ResearchReview = z.infer<typeof researchReviewSchema>;
export const submissionSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION), requestId: identifier, sessionId: identifier,
  objectId: identifier, action: z.literal('receive_reference'),
  review: z.object({ format: z.literal('aipoch-network-internal-review-1'),
    content: z.string().min(1).max(MAX_BODY_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
}).strict();
export type Submission = z.infer<typeof submissionSchema>;
export interface Receipt {
  protocolVersion: typeof PROTOCOL_VERSION; requestId: string; sessionId: string; objectId: string;
  contentSha256: string; outcome: 'received'; receivedAt: number;
}
export interface HostStatus { ready: boolean; instanceId: string; hostId?: string; version?: string; reason?: string }
export interface Host {
  status(): Promise<HostStatus>;
  listProjects(): Promise<Array<{id: string; name: string}>>;
  createProject(input: {name: string; description?: string; idempotencyKey?: string; expectedHostId?: string}): Promise<{id: string; name: string}>;
}
export class ConnectorError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}
export function parseSubmission(input: unknown): Submission {
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) throw new ConnectorError('invalid_reference', 'The reference envelope is invalid.');
  const submission = parsed.data;
  if (Buffer.byteLength(submission.review.content) > MAX_BODY_BYTES || digest(submission.review.content) !== submission.review.sha256)
    throw new ConnectorError('content_mismatch', 'The exact reviewed content does not match its digest.');
  const review = parseResearchReview(submission.review.content);
  if (review.format !== submission.review.format || review.object.id !== submission.objectId)
    throw new ConnectorError('invalid_review', 'The reviewed object and envelope must match.');
  return submission;
}
export function parseResearchReview(content: string): ResearchReview {
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BODY_BYTES)
    throw new ConnectorError('invalid_review', 'The complete review exceeds the supported byte budget.');
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new ConnectorError('invalid_review', 'The review must be complete JSON.'); }
  assertUnambiguousReviewJson(content);
  const result = researchReviewSchema.safeParse(value);
  if (!result.success) throw new ConnectorError('invalid_review', 'The reviewed object, full sources, licenses, conditions and target must be complete and valid.');
  return result.data;
}
/** JSON.parse has already validated syntax. Reject duplicate keys before a later reader can
 * interpret different source/license values from the same approved bytes. */
function assertUnambiguousReviewJson(content: string): void {
  let position = 0;
  const whitespace = () => { while (/\s/.test(content[position] ?? '') && position < content.length) position++; };
  const string = (): string => {
    const start = position++;
    while (position < content.length) {
      if (content[position] === '\\') { position += 2; continue; }
      if (content[position++] === '"') return content.slice(start, position);
    }
    throw new ConnectorError('invalid_review', 'The review must be complete JSON.');
  };
  const value = (depth: number): void => {
    if (depth > 64) throw new ConnectorError('invalid_review', 'The review exceeds the supported nesting depth.');
    whitespace();
    if (content[position] === '"') { string(); return; }
    if (content[position] === '{') {
      position++; whitespace(); const keys = new Set<string>();
      while (content[position] !== '}') {
        whitespace(); const key = JSON.parse(string()) as string;
        if (keys.has(key)) throw new ConnectorError('invalid_review', 'The review contains ambiguous duplicate JSON fields.');
        keys.add(key); whitespace(); position++; value(depth + 1); whitespace();
        if (content[position] === ',') position++; else break;
      }
      position++; return;
    }
    if (content[position] === '[') {
      position++; whitespace();
      while (content[position] !== ']') { value(depth + 1); whitespace(); if (content[position] === ',') position++; else break; }
      position++; return;
    }
    while (position < content.length && !/[\s,}\]]/.test(content[position]!)) position++;
  };
  value(0);
}
