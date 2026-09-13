import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import type { DeviceToken } from './github/device-auth.js';

const SECURITY = '/usr/bin/security';
const SERVICE = 'network.aipoch.connector.github';
const MAX_OUTPUT_BYTES = 65_536;
const MAX_ENCODED_BYTES = 32_768;
const TIMEOUT_MS = 30_000;
const ITEM_NOT_FOUND = 44;

export interface CredentialCommand {
  executable: string;
  args: readonly string[];
  input?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}
export interface CredentialCommandResult { code: number; stdout: string; stderr: string }
export interface CredentialStoreDependencies {
  platform?: NodeJS.Platform;
  now?: () => number;
  run?: (command: CredentialCommand) => Promise<CredentialCommandResult>;
}

export class CredentialStoreError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

function failure(code: string): CredentialStoreError {
  const messages: Record<string, string> = {
    credential_store_unsupported: 'Protected GitHub credential storage is currently supported only on macOS. Use an explicitly supplied environment token on other platforms.',
    credential_store_unavailable: 'The protected credential store could not complete the operation.',
    credential_invalid: 'The stored GitHub credential is invalid or uses an unsupported format.',
    credential_write_unconfirmed: 'The protected credential write could not be verified.',
  };
  return new CredentialStoreError(code, messages[code] ?? 'The credential operation failed.');
}

/** No shell, terminal inheritance, command echo, or raw subprocess errors escape this boundary. */
async function runSecurity(command: CredentialCommand): Promise<CredentialCommandResult> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command.executable, [...command.args], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let finished = false;
    const finish = (error?: Error, code?: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(failure('credential_store_unavailable'));
      else resolveCommand({ code: code ?? 1, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(failure('credential_store_unavailable'));
    }, command.timeoutMs);
    const capture = (chunks: Buffer[], chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > command.maxOutputBytes) {
        child.kill();
        finish(failure('credential_store_unavailable'));
      } else chunks.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
    child.on('error', error => finish(error));
    child.on('close', code => finish(undefined, code ?? 1));
    child.stdin.on('error', error => finish(error));
    child.stdin.end(command.input ?? '');
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function secret(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u0020\u007f]/.test(value);
}
function time(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function validatedToken(value: unknown): DeviceToken {
  if (!isRecord(value) || !secret(value.accessToken) || value.tokenType !== 'bearer' ||
      (value.scope !== undefined && (typeof value.scope !== 'string' || value.scope.length > 4096 || /[\u0000-\u001f\u007f]/.test(value.scope))) ||
      (value.expiresAt !== undefined && !time(value.expiresAt)) ||
      (value.refreshToken !== undefined && !secret(value.refreshToken)) ||
      (value.refreshTokenExpiresAt !== undefined && (!time(value.refreshTokenExpiresAt) || value.refreshToken === undefined))) {
    throw failure('credential_invalid');
  }
  return {
    accessToken: value.accessToken, tokenType: 'bearer',
    ...(value.scope !== undefined ? { scope: value.scope as string } : {}),
    ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt as number } : {}),
    ...(value.refreshToken !== undefined ? { refreshToken: value.refreshToken as string } : {}),
    ...(value.refreshTokenExpiresAt !== undefined ? { refreshTokenExpiresAt: value.refreshTokenExpiresAt as number } : {}),
  };
}
function encode(token: DeviceToken): string {
  const value = Buffer.from(JSON.stringify({ schemaVersion: 1, token: validatedToken(token) }), 'utf8').toString('base64');
  if (value.length > MAX_ENCODED_BYTES) throw failure('credential_invalid');
  return value;
}
function decode(value: string): DeviceToken {
  const encoded = value.trim();
  if (!encoded || encoded.length > MAX_ENCODED_BYTES || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw failure('credential_invalid');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw failure('credential_invalid');
  try {
    const envelope: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(envelope) || envelope.schemaVersion !== 1) throw failure('credential_invalid');
    return validatedToken(envelope.token);
  } catch { throw failure('credential_invalid'); }
}

/** A project-specific Keychain item. No Open-Science credentials or plaintext fallback are read. */
export class CredentialStore {
  private readonly platform: NodeJS.Platform;
  private readonly now: () => number;
  private readonly run: NonNullable<CredentialStoreDependencies['run']>;
  private readonly account: string;

  constructor(dataDir: string, dependencies: CredentialStoreDependencies = {}) {
    if (typeof dataDir !== 'string' || !isAbsolute(dataDir) || dataDir.includes('\0')) {
      throw new CredentialStoreError('invalid_data_directory', 'The Connector data directory must be absolute.');
    }
    this.account = createHash('sha256').update(resolve(dataDir)).digest('hex');
    this.platform = dependencies.platform ?? process.platform;
    this.now = dependencies.now ?? Date.now;
    this.run = dependencies.run ?? runSecurity;
  }

  private async command(args: string[], input?: string): Promise<CredentialCommandResult> {
    if (this.platform !== 'darwin') throw failure('credential_store_unsupported');
    try {
      const result = await this.run({ executable: SECURITY, args, ...(input !== undefined ? { input } : {}),
        timeoutMs: TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES });
      if (!Number.isSafeInteger(result.code) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' ||
          Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > MAX_OUTPUT_BYTES) {
        throw failure('credential_store_unavailable');
      }
      return result;
    } catch { throw failure('credential_store_unavailable'); }
  }

  private async read(): Promise<DeviceToken | undefined> {
    const result = await this.command(['find-generic-password', '-a', this.account, '-s', SERVICE, '-w']);
    if (result.code === ITEM_NOT_FOUND) return undefined;
    if (result.code !== 0) throw failure('credential_store_unavailable');
    return decode(result.stdout);
  }

  /** Returns only a currently usable access credential; expired tokens are never used implicitly. */
  async getGithub(): Promise<DeviceToken | undefined> {
    const token = await this.read();
    return token && (token.expiresAt === undefined || token.expiresAt > this.now()) ? token : undefined;
  }

  /** Explicit refresh/reconciliation access. This result is NOT permission to use its access token. */
  async getGithubForRefresh(): Promise<DeviceToken | undefined> {
    return this.read();
  }

  async setGithub(token: DeviceToken): Promise<void> {
    const value = encode(token);
    // Only fixed identifiers and base64 characters enter the interactive command parser.
    // EOF ends security's interactive mode; it has no "quit" command.
    const result = await this.command(['-i'], `add-generic-password -U -a ${this.account} -s ${SERVICE} -w ${value}\n`);
    if (result.code !== 0) throw failure('credential_store_unavailable');
    const stored = await this.read();
    if (!stored || encode(stored) !== value) throw failure('credential_write_unconfirmed');
  }

  async deleteGithub(): Promise<void> {
    const result = await this.command(['delete-generic-password', '-a', this.account, '-s', SERVICE]);
    if (result.code !== 0 && result.code !== ITEM_NOT_FOUND) throw failure('credential_store_unavailable');
  }
}
