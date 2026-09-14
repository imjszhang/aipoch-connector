// Optional real-browser transport acceptance. No product approval or real host is used.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
//   node --import tsx tests/browser-loopback.mjs
// BROWSER_CHANNEL=chrome selects an installed Chrome; omit for Playwright Chromium.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, platform, release, arch } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBridge } from '../src/bridge.ts';
import { ConnectorCore } from '../src/core.ts';
import { Inbox } from '../src/inbox.ts';
import { configuration } from '../src/runtime.ts';
import { packageVersion } from '../src/version.ts';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const temporary = await mkdtemp(join(tmpdir(), 'aipoch-browser-loopback-'));
const servers = [];
let browser;
const inbox = new Inbox(':memory:');
const host = {
  status: async () => ({ ready: true, instanceId: 'synthetic-browser-transport-host' }),
  listProjects: async () => { throw new Error('Browser transport must not list projects'); },
  createProject: async () => { throw new Error('Browser transport must not create projects'); },
};
const core = new ConnectorCore(inbox, host);
const observations = [];
const listen = async (server, host) => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => { server.removeListener('error', reject); resolve(); });
  });
  servers.push(server);
  return server.address().port;
};
const fixture = async (host, originHost = host) => {
  const port = await listen(createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><title>Synthetic Connector transport fixture</title><p>No product approvals or research actions.</p>');
  }), host);
  const origin = `http://${originHost}:${port}`;
  const page = await browser.newPage();
  await page.goto(origin);
  assert.equal(await page.evaluate(() => location.origin), origin);
  return { page, origin };
};
const bridge = async config => {
  const observed = [];
  const server = createBridge(core, { ...config, adminToken: 'synthetic-owner-unused' });
  server.on('request', (request, response) => {
    response.once('finish', () => observed.push({
      method: request.method, path: request.url, origin: request.headers.origin,
      status: response.statusCode, cors: response.getHeader('Access-Control-Allow-Origin'),
      vary: response.getHeader('Vary'),
    }));
  });
  return { url: `http://127.0.0.1:${await listen(server, '127.0.0.1')}`, observed };
};
const call = (page, target, path, { method = 'GET', data, token, plain = false } = {}) =>
  page.evaluate(async ({ url, method, data, token, plain }) => {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...(data ? { 'Content-Type': plain ? 'text/plain' : 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      return { status: response.status, body: await response.json() };
    } catch (error) { return { browserBlocked: error instanceof TypeError }; }
  }, { url: target.url + path, method, data, token, plain });
const pair = (page, target, suffix) => call(page, target, '/v1/pairings', {
  method: 'POST', data: { protocolVersion: '1.0', attemptId: `browser-loopback-${suffix}` },
});

try {
  const config = await configuration(temporary);
  assert.equal(config.allowLoopbackHttp, true);
  assert.deepEqual(config.origins, ['https://aipoch.network']);
  browser = await chromium.launch({ headless: true, args: ['--enable-automation'],
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const devtools = await browser.newBrowserCDPSession();
  const { arguments: launchArguments } = await devtools.send('Browser.getBrowserCommandLine');
  assert.ok(!launchArguments.some(value => /disable-web-security|disable-site-isolation-trials|host-resolver-rules/.test(value)),
    'Do not bypass browser origin isolation or DNS rules');
  await devtools.detach();
  const first = await fixture('127.0.0.1', 'localhost');
  const second = await fixture('127.0.0.1', 'localhost');
  const ipv4 = await fixture('127.0.0.1');
  const pages = [first, second, ipv4];
  let ipv6 = 'not tested';
  try { pages.push(await fixture('::1', '[::1]')); ipv6 = 'passed'; }
  catch (error) { ipv6 = `unavailable: ${error.code ?? error.name}`; }
  const enabled = await bridge(config);
  const pairings = [];
  for (const [index, item] of pages.entries()) {
    const result = await pair(item.page, enabled, index);
    assert.equal(result.status, 200, item.origin);
    assert.ok(result.body.pairingId);
    const poll = await call(item.page, enabled, `/v1/pairings/${result.body.pairingId}`, { token: result.body.pollToken });
    assert.equal(poll.body.status, 'pending');
    const missingToken = await call(item.page, enabled, '/v1/session');
    assert.equal(missingToken.status, 401);
    assert.equal(missingToken.body.error.code, 'unauthorized');
    const preflight = enabled.observed.find(row => row.origin === item.origin && row.method === 'OPTIONS' && row.path === '/v1/pairings');
    const request = enabled.observed.find(row => row.origin === item.origin && row.method === 'POST' && row.path === '/v1/pairings');
    assert.equal(preflight?.status, 204);
    assert.equal(request?.status, 200);
    assert.equal(preflight.cors, item.origin);
    assert.equal(request.cors, item.origin);
    assert.equal(preflight.vary, 'Origin');
    assert.equal(request.vary, 'Origin');
    pairings.push(result.body);
    observations.push({ origin: item.origin, preflight: 204, pairing: 200, pending: true, unauthenticatedSession: 401 });
  }
  for (const item of pages.slice(1)) {
    const swapped = await call(item.page, enabled, `/v1/pairings/${pairings[0].pairingId}`, { token: pairings[0].pollToken });
    assert.equal(swapped.status, 401);
    assert.equal(swapped.body.error.code, 'unauthorized');
  }
  // A simple browser POST reaches the actual admin handler with Origin, without preflight.
  const admin = await call(first.page, enabled, '/admin/status', { method: 'POST', plain: true, data: { fixture: true } });
  assert.equal(admin.browserBlocked, true);
  assert.ok(enabled.observed.some(row => row.path === '/admin/status' && row.method === 'POST' && row.origin === first.origin && row.status === 401 && !row.cors));
  const adminPreflight = await call(first.page, enabled, '/admin/status', { token: 'synthetic-owner-unused' });
  assert.equal(adminPreflight.browserBlocked, true);
  assert.ok(enabled.observed.some(row => row.path === '/admin/status' && row.method === 'OPTIONS' && row.status === 401 && !row.cors));

  const disabled = await bridge({ ...config, allowLoopbackHttp: false });
  for (const item of pages) {
    assert.equal((await pair(item.page, disabled, 'disabled')).browserBlocked, true);
    assert.equal((await call(item.page, disabled, '/v1/session')).browserBlocked, true);
    assert.ok(disabled.observed.some(row => row.origin === item.origin && row.method === 'OPTIONS' && row.status === 403 && !row.cors));
    assert.ok(disabled.observed.some(row => row.origin === item.origin && row.method === 'GET' && row.status === 403 && !row.cors));
    assert.ok(!disabled.observed.some(row => row.origin === item.origin && row.method === 'POST'));
  }
  const explicit = await bridge({ ...config, allowLoopbackHttp: false, origins: [...config.origins, first.origin] });
  assert.equal((await pair(first.page, explicit, 'explicit')).status, 200);
  assert.equal((await pair(second.page, explicit, 'not-explicit')).browserBlocked, true);
  assert.equal(core.pendingPairings().length, pages.length + 1);
  assert.equal(inbox.list().length, 0);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(), connector: packageVersion, browser: browser.version(),
    channel: process.env.BROWSER_CHANNEL ?? 'playwright-chromium',
    userAgent: await first.page.evaluate(() => navigator.userAgent),
    system: `${platform()} ${release()} ${arch()}`, configOrigins: config.origins,
    observations, ipv6, crossOriginPairingToken: 'rejected',
    browserAdminActualAndPreflight: 'rejected', policyOffActualAndPreflight: 'rejected',
    policyOffExplicitOrigin: 'passed', pendingOnly: true,
    scope: 'Real browser transport against isolated synthetic core. No real Network UI, real host, product approvals, session approval or receipt delivery.',
  }, null, 2));
} finally {
  await browser?.close();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  inbox.close();
  await rm(temporary, { recursive: true, force: true });
}
