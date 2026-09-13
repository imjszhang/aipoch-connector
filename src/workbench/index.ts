import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { connectToOpenScience, type OpenScienceClient } from '../../vendor/open-science/index.mjs';

const executeFile = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../vendor/open-science/cli.mjs', import.meta.url));
const REQUEST_TIMEOUT_MS = 5_000;

export type HostStatus = { ready: boolean; hostId: string; instanceId: string; version?: string; reason?: string };
export type HostProject = { id: string; name: string };
export type HostLifecycle = {
  running: boolean;
  pid?: number;
  port?: number;
  startedAt?: string;
  configRoot?: string;
  appVersion?: string;
};
export type HostClient = Pick<OpenScienceClient,
  'health' | 'listProjects' | 'createProject' | 'listConnectors' | 'addConnector' | 'setConnectorEnabled'>;
export type OpenScienceHostOptions = { configRoot?: string; baseUrl?: string };
/** Injection keeps unit/HTTP-fixture tests independent from any installed desktop app. */
export type HostDependencies = {
  client?: HostClient;
  connect?: (options: { configRoot?: string; requestTimeoutMs: number }) => Promise<HostClient>;
  readLifecycle?: (configRoot?: string) => Promise<HostLifecycle>;
};

export class HostError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'HostError';
  }
}

function hostError(code: string): HostError {
  const messages: Record<string, string> = {
    host_not_running: 'Open-Science is not running.',
    host_lifecycle_unavailable: 'The authenticated host startup identity is unavailable.',
    host_endpoint_mismatch: 'The selected endpoint does not match the authenticated local host.',
    host_changed: 'Open-Science changed or restarted. Connect again before continuing.',
    host_unavailable: 'Open-Science could not be reached through its public interface.',
    host_api_unsupported: 'This Open-Science build does not provide the required public API.',
    host_authentication_failed: 'The local Open-Science connection could not be authenticated.',
    host_outcome_unknown: 'The host write may have completed. Reconcile its result before retrying.',
    host_invalid_response: 'Open-Science returned an unsupported response.',
    mcp_registration_conflict: 'A different AIPOCH Connector configuration already exists.',
  };
  return new HostError(code, messages[code] ?? 'The Open-Science operation failed.');
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function parseLifecycle(value: unknown): HostLifecycle {
  const item = record(value);
  if (item?.running === false) return { running: false };
  if (item?.running !== true || !Number.isSafeInteger(item.pid) || Number(item.pid) <= 0 ||
      !Number.isSafeInteger(item.port) || Number(item.port) < 1 || Number(item.port) > 65_535 ||
      typeof item.startedAt !== 'string' || !Number.isFinite(Date.parse(item.startedAt)) ||
      typeof item.configRoot !== 'string' || !isAbsolute(item.configRoot)) {
    throw hostError('host_lifecycle_unavailable');
  }
  return {
    running: true, pid: Number(item.pid), port: Number(item.port), startedAt: item.startedAt,
    configRoot: item.configRoot,
    ...(typeof item.appVersion === 'string' ? { appVersion: item.appVersion } : {}),
  };
}

function lifecycleId(state: HostLifecycle): string {
  if (!state.running) throw hostError('host_not_running');
  return createHash('sha256').update(JSON.stringify([
    state.configRoot, state.pid, state.port, state.startedAt,
  ])).digest('hex');
}

function stableHostId(state: HostLifecycle): string {
  return createHash('sha256').update(`open-science-config\0${state.configRoot}`).digest('hex');
}

/** Calls the distributed public CLI, not private config/state-file readers. Never starts the host. */
export async function readOpenScienceLifecycle(configRoot?: string): Promise<HostLifecycle> {
  const args = [CLI_PATH, 'status', '--json', ...(configRoot ? ['--config-root', configRoot] : [])];
  try {
    const { stdout } = await executeFile(process.execPath, args, {
      timeout: REQUEST_TIMEOUT_MS, maxBuffer: 64 * 1_024, windowsHide: true,
    });
    return parseLifecycle(JSON.parse(stdout));
  } catch (error) {
    // The public CLI uses exit code 1 for a valid { running: false } status.
    const output = record(error)?.stdout;
    if (typeof output === 'string') {
      try {
        const value = parseLifecycle(JSON.parse(output));
        if (!value.running) return value;
      } catch { /* Do not expose raw CLI errors, output, or local paths. */ }
    }
    throw hostError('host_lifecycle_unavailable');
  }
}

function expectedPort(baseUrl: string | undefined): number | undefined {
  if (baseUrl === undefined) return undefined;
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw hostError('host_endpoint_mismatch'); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw hostError('host_endpoint_mismatch');
  }
  return Number(url.port || '80');
}

/** Only this adapter imports the public, pinned SDK. It never runs research to receive a reference. */
export class OpenScienceHost {
  private readonly port: number | undefined;
  private readonly connect: NonNullable<HostDependencies['connect']>;
  private readonly readLifecycle: NonNullable<HostDependencies['readLifecycle']>;
  private cached?: { instanceId: string; client: HostClient };

  constructor(private readonly options: OpenScienceHostOptions = {}, dependencies: HostDependencies = {}) {
    if (options.configRoot !== undefined && !isAbsolute(options.configRoot)) {
      throw new HostError('invalid_config_root', 'The Open-Science configuration root must be absolute.');
    }
    this.port = expectedPort(options.baseUrl);
    this.connect = dependencies.client ? async () => dependencies.client! :
      dependencies.connect ?? connectToOpenScience;
    this.readLifecycle = dependencies.readLifecycle ?? readOpenScienceLifecycle;
  }

  private async lifecycle(configRoot = this.options.configRoot): Promise<HostLifecycle> {
    const state = parseLifecycle(await this.readLifecycle(configRoot));
    if (!state.running) throw hostError('host_not_running');
    if (this.port !== undefined && state.port !== this.port) throw hostError('host_endpoint_mismatch');
    return state;
  }

  private async probe(): Promise<{ client: HostClient; state: HostLifecycle; instanceId: string; version?: string }> {
    try {
      const state = await this.lifecycle();
      const instanceId = lifecycleId(state);
      let client = this.cached?.instanceId === instanceId ? this.cached.client : undefined;
      if (!client) client = await this.connect({ configRoot: state.configRoot, requestTimeoutMs: REQUEST_TIMEOUT_MS });
      const bootstrap = record(await client.health({ timeoutMs: REQUEST_TIMEOUT_MS }));
      if (!bootstrap || typeof bootstrap.appVersion !== 'string') throw hostError('host_invalid_response');
      const after = await this.lifecycle(state.configRoot);
      if (lifecycleId(after) !== instanceId) throw hostError('host_changed');
      this.cached = { client, instanceId };
      return { client, state, instanceId, version: bootstrap.appVersion };
    } catch (error) {
      this.cached = undefined;
      if (error instanceof HostError) throw error;
      const status = record(error)?.status;
      throw hostError(status === 401 || status === 403 ? 'host_authentication_failed' : 'host_unavailable');
    }
  }

  async status(): Promise<HostStatus> {
    try {
      const { state, instanceId, version } = await this.probe();
      return { ready: true, hostId: stableHostId(state), instanceId, ...(version ? { version } : {}) };
    } catch (error) {
      return { ready: false, hostId: '', instanceId: '', reason: error instanceof HostError ? error.code : 'host_unavailable' };
    }
  }

  private async operation<T>(write: boolean, action: (client: HostClient, markWriteSubmitted: () => void) => Promise<T>, expectedHostId?: string): Promise<T> {
    const { client, state, instanceId } = await this.probe();
    // Compare against the authenticated instance that supplied this exact client, not an earlier
    // status call. Default discovery may choose a different profile between those calls.
    if (expectedHostId !== undefined && stableHostId(state) !== expectedHostId) throw hostError('host_changed');
    let writeSubmitted = write;
    try {
      const value = await action(client, () => { writeSubmitted = true; });
      if (lifecycleId(await this.lifecycle(state.configRoot)) !== instanceId) throw hostError('host_changed');
      return value;
    } catch (error) {
      this.cached = undefined;
      if (error instanceof HostError && error.code === 'mcp_registration_conflict') throw error;
      // No automatic retry: host idempotency is process-local and can disappear after restart.
      if (writeSubmitted) throw hostError('host_outcome_unknown');
      if (record(error)?.status === 404 || record(error)?.status === 405) throw hostError('host_api_unsupported');
      throw error instanceof HostError ? error : hostError('host_unavailable');
    }
  }

  async listProjects(): Promise<HostProject[]> {
    return this.operation(false, async client => {
      const projects = await client.listProjects({ timeoutMs: REQUEST_TIMEOUT_MS });
      if (!Array.isArray(projects)) throw hostError('host_invalid_response');
      return projects.map(project => this.project(project));
    });
  }

  async createProject(input: { name: string; description?: string; idempotencyKey?: string; expectedHostId?: string }): Promise<HostProject> {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 1_024 ||
        (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 16_384)) ||
        (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey || input.idempotencyKey.length > 256)) ||
        (input.expectedHostId !== undefined && (typeof input.expectedHostId !== 'string' || !/^[a-zA-Z0-9:._-]{1,200}$/.test(input.expectedHostId)))) {
      throw new HostError('invalid_project', 'A project needs a valid name and bounded optional description and request key.');
    }
    return this.operation(true, async client => this.project(await client.createProject({
      name: input.name, ...(input.description !== undefined ? { description: input.description } : {}),
    }, { timeoutMs: REQUEST_TIMEOUT_MS, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) })), input.expectedHostId);
  }

  private project(value: unknown): HostProject {
    const project = record(value);
    if (typeof project?.id !== 'string' || !project.id || typeof project.name !== 'string') {
      throw hostError('host_invalid_response');
    }
    return { id: project.id, name: project.name };
  }

  async registerMcp(input: { command: string; args: string[] }): Promise<unknown> {
    if (typeof input.command !== 'string' || !input.command.trim() || input.command.includes('\0') ||
        !Array.isArray(input.args) || input.args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
      throw new HostError('invalid_mcp_configuration', 'A command and string arguments are required.');
    }
    return this.operation(false, async (client, markWriteSubmitted) => {
      const snapshot = await client.listConnectors({ timeoutMs: REQUEST_TIMEOUT_MS });
      if (!Array.isArray(snapshot.customServers)) throw hostError('host_invalid_response');
      let existing = snapshot.customServers.find(server => server.id === 'aipoch-connector' || server.name === 'aipoch-connector');
      if (existing && (existing.transport !== 'stdio' || existing.command !== input.command ||
          JSON.stringify(existing.args ?? []) !== JSON.stringify(input.args))) {
        throw hostError('mcp_registration_conflict');
      }
      let saved = snapshot;
      if (!existing) {
        markWriteSubmitted();
        saved = await client.addConnector({
          id: 'aipoch-connector', name: 'aipoch-connector', displayName: 'AIPOCH Connector',
          description: 'Use AIPOCH Network references in the local research workbench.',
          transport: 'stdio', command: input.command, args: [...input.args],
        }, { timeoutMs: REQUEST_TIMEOUT_MS });
        existing = saved.customServers.find(server => server.id === 'aipoch-connector' || server.name === 'aipoch-connector');
        if (!existing) throw hostError('host_invalid_response');
      }
      if (!existing.enabled) {
        markWriteSubmitted();
        await client.setConnectorEnabled(existing.id, true, { timeoutMs: REQUEST_TIMEOUT_MS });
      }
      return { id: existing.id, name: existing.name, enabled: true };
    });
  }
}
