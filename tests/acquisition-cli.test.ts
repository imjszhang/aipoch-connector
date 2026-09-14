import test from 'node:test';
import { verifyAcquisition } from './helpers/acquisition-acceptance.mjs';
import { resolve } from 'node:path';
test('CLI and stdio recovery acceptance across resolution and runtime restart', {timeout:30000}, () => verifyAcquisition(resolve('.'), true));
