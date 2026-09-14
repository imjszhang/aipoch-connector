import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveAllowLoopbackHttp, isAllowedBrowserOrigin } from '../src/origin-policy.js';

test('loopback default is true only for missing values and accepts exact booleans', () => {
  assert.equal(effectiveAllowLoopbackHttp(undefined), true);
  assert.equal(effectiveAllowLoopbackHttp(true), true);
  assert.equal(effectiveAllowLoopbackHttp(false), false);
  for (const value of [null, 0, 1, '', 'false', 'true', [], {}, () => true]) {
    assert.throws(() => effectiveAllowLoopbackHttp(value), /allowLoopbackHttp.*boolean/);
  }
});

test('implicit policy allows only canonical HTTP origins for the three selected hostnames', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    for (const port of ['', ':0', ':1', ':3000', ':4193', ':5173', ':65535']) {
      const origin = `http://${hostname}${port}`;
      assert.equal(isAllowedBrowserOrigin(origin, [], true), true, origin);
      assert.equal(isAllowedBrowserOrigin(origin, [], false), false, origin);
      assert.equal(isAllowedBrowserOrigin(origin, []), false, origin);
    }
  }
});

test('implicit origin parsing rejects aliases, malformed values, other schemes and other hosts', () => {
  const rejected = ['', 'null', 'undefined', '*', 'localhost', 'http://', 'http://localhost:',
    'http://localhost:80', 'http://localhost:03000', 'http://localhost:65536', 'http://localhost:-1',
    'http://LOCALHOST:3000', 'HTTP://localhost:3000', ' http://localhost:3000', 'http://localhost:3000 ',
    'http://localhost:3000\n', 'http://localhost:3000/', 'http://localhost:3000/path',
    'http://localhost:3000?query', 'http://localhost:3000#fragment', 'http://user@localhost:3000',
    'http://user:secret@localhost:3000', 'http://localhost:3000,http://127.0.0.1:3000',
    'http://localhost:3000 http://127.0.0.1:3000', 'http://localhost.evil.example:3000',
    'http://evil.localhost:3000', 'http://localhost.:3000', 'http://127.0.0.2:3000',
    'http://0.0.0.0:3000', 'http://192.168.1.1:3000', 'http://10.0.0.1:3000',
    'http://[::2]:3000', 'http://[::ffff:127.0.0.1]:3000', 'http://[::ffff:7f00:1]:3000',
    'http://[0:0:0:0:0:0:0:1]:3000', 'http://[::1%25lo0]:3000', 'http://2130706433:3000',
    'http://0x7f000001:3000', 'http://0177.0.0.1:3000', 'http://127.1:3000', 'http://127.0.1:3000',
    'http://127.000.000.001:3000', 'http://127.0.0.1.:3000', 'http://%6cocalhost:3000',
    'https://localhost:3000', 'ws://localhost:3000', 'file://localhost',
    'http://example.test:3000', 'https://example.test', 'https://aipoch.network', 'https://www.aipoch.network'];
  for (const origin of rejected) assert.equal(isAllowedBrowserOrigin(origin, [], true), false, origin);
});

test('explicit origins remain exact and independent from implicit loopback permission', () => {
  const origins = Object.freeze(['https://aipoch.network', 'http://localhost:4193', 'https://localhost:3000']);
  for (const enabled of [true, false]) {
    for (const origin of origins) assert.equal(isAllowedBrowserOrigin(origin, origins, enabled), true, origin);
    assert.equal(isAllowedBrowserOrigin('https://aipoch.network:443', origins, enabled), false);
    assert.equal(isAllowedBrowserOrigin('https://www.aipoch.network', origins, enabled), false);
    assert.equal(isAllowedBrowserOrigin('http://localhost:4194', origins, enabled), enabled);
  }
  assert.deepEqual(origins, ['https://aipoch.network', 'http://localhost:4193', 'https://localhost:3000']);
});
