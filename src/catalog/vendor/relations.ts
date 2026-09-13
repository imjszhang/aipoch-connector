import type { Relation } from './types.js';

/** Object-level relationship meaning; repository ownership never proves authorship. */
export function relationKindsAllowed(type: Relation['type'], from: string, to: string): boolean {
  if (from === 'tombstone' || to === 'tombstone') return true;
  if (type === 'fork_of') return from === 'source_repository' && to === 'source_repository';
  if (type === 'produces') return from === 'project' && to === 'resource';
  if (['authored_by', 'maintained_by', 'curated_by'].includes(type)) return to === 'actor' && from !== 'actor';
  if (type === 'uses') return ['project', 'resource'].includes(from) && ['source_repository', 'resource'].includes(to);
  if (type === 'supersedes') return from === to;
  return true;
}
