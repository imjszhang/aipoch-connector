import { resolve, parse } from 'node:path';
import { ConnectorError, digest } from './contracts.js';
import { validateResolvedGithubSource } from './github/index.js';

/** JSON object ordering is not intent; arrays (including source/condition order) remain ordered. */
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function acquisitionIdentity(input: any) {
  validateResolvedGithubSource(input.source);
  if (!input.source.path || typeof input.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedSha256))
    throw new ConnectorError('confirmation_required', 'Provide the exact file path and reviewed SHA-256.');
  if (typeof input.destination !== 'string' || !input.destination || /[\u0000-\u001f\u007f]/.test(input.destination))
    throw new ConnectorError('invalid_destination', 'Choose a new destination directory.');
  const destination = resolve(input.destination);
  if (destination === parse(destination).root) throw new ConnectorError('invalid_destination', 'Choose a new destination directory.');
  const source = structuredClone(input.source);
  delete source.resolvedAt;
  if (source.repositoryLicenseObservation) delete source.repositoryLicenseObservation.observedAt;
  // Preserve every other source field, including license/conditions and future metadata.
  const identity = {version:1, kind:'acquire_github_file', source, expectedSha256:input.expectedSha256, destination};
  return {hash:digest(JSON.stringify(canonical(identity))), destination};
}
