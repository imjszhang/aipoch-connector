import test from 'node:test';
import { resolve } from 'node:path';
import { verifyLoopback } from './helpers/loopback-acceptance.mjs';

test('fresh and legacy runtime defaults, CLI policy switches, HTTP origin isolation and durable restart',
  { timeout: 60_000 }, () => verifyLoopback(resolve('.'), true));
