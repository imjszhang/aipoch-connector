import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { verifyAcquisition } from './helpers/acquisition-acceptance.mjs';
import { verifyLoopback } from './helpers/loopback-acceptance.mjs';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'aipoch-package-smoke-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, cwd = root) => execute(command, args, { cwd, timeout: 180000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' } });
try {
  const external = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const packed = JSON.parse((await run(npm, ['pack', ...(external ? [external] : []), '--ignore-scripts', '--json', '--pack-destination', temporary])).stdout);
  assert.equal(packed.length, 1);
  const names = new Set(packed[0].files.map(file => file.path));
  for (const name of ['dist/cli.js', 'dist/runtime.js', 'dist/workbench/index.js', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'vendor/open-science/index.mjs', 'vendor/open-science/cli.mjs', 'vendor/open-science/LICENSE', 'vendor/open-science/ORIGIN.json', 'docs/protocol.md', 'docs/operations.md']) assert.ok(names.has(name), `Required package file missing: ${name}`);
  for (const name of names) assert.ok(!/(^|\/)(?:\.env(?:\.|$)|runtime\.json$|runtime\.lock$|inbox\.sqlite(?:-|$)|node_modules\/|\.git\/|\.local\/)/.test(name), `Private or generated runtime state in package: ${name}`);
  const install = join(temporary, 'consumer');
  await run(npm, ['install', '--prefix', install, '--ignore-scripts', '--package-lock=false', '--no-audit', '--no-fund', external ?? join(temporary, packed[0].filename)]);
  const packageRoot = join(install, 'node_modules', 'aipoch-connector');
  const installed = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(installed.version, packed[0].version);
  const statePath = join(temporary, 'should-not-be-created');
  const help = await run(process.execPath, [join(packageRoot, 'dist/cli.js'), 'help', '--data-dir', statePath], install);
  assert.match(help.stdout, /AIPOCH Connector/); assert.match(help.stdout, /pair list/);
  await assert.rejects(access(statePath), { code: 'ENOENT' });
  const { connectToOpenScience } = await import(pathToFileURL(join(packageRoot, 'vendor/open-science/index.mjs')).href);
  assert.equal(typeof connectToOpenScience, 'function');
  const { OpenScienceHost } = await import(pathToFileURL(join(packageRoot, 'dist/workbench/index.js')).href);
  const { Inbox } = await import(pathToFileURL(join(packageRoot, 'dist/inbox.js')).href);
  assert.equal(typeof OpenScienceHost, 'function');
  const inbox = new Inbox(':memory:'); assert.deepEqual(inbox.list(), []); inbox.close();
  const origin = JSON.parse(await readFile(join(packageRoot, 'vendor/open-science/ORIGIN.json'), 'utf8'));
  for (const [file, expected] of Object.entries(origin.files)) {
    const bytes = await readFile(join(packageRoot, 'vendor/open-science', file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `Vendored SDK distribution changed: ${file}`);
  }
  assert.equal(await readFile(join(packageRoot, 'vendor/open-science/index.d.mts'), 'utf8'), await readFile(join(packageRoot, 'vendor/open-science/index.d.ts'), 'utf8'));
  await verifyAcquisition(packageRoot);
  await verifyLoopback(packageRoot);
  if(process.argv.includes('--live')) process.stdout.write(JSON.stringify(await verifyAcquisition(packageRoot,false,true))+'\n');
  process.stdout.write(`Packed and independently installed aipoch-connector ${installed.version}; CLI help, public SDK integrity and local inbox import, isolated CLI recovery, stdio version/discovery, default/disabled local HTTP origins, CLI setup, session isolation and durable restart checks passed. Temporary Connector runtimes and a synthetic public SDK HTTP fixture were used; no desktop host was started and this is not browser evidence.\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
