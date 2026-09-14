import { readFileSync } from 'node:fs';

/** One product version source for source, built and independently installed execution. */
export const packageManifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const manifest = JSON.parse(packageManifest);
if (manifest.name !== 'aipoch-connector' || typeof manifest.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version))
  throw new Error('Connector package manifest has an invalid product version.');
export const packageVersion: string = manifest.version;
