import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectorCore } from '../src/core.js';
import { Inbox } from '../src/inbox.js';
import { PAIRING_TTL, type Host } from '../src/contracts.js';

const origin = 'https://aipoch.network';
function fixture() {
  let now = 1_000, gate: Promise<void> | undefined, release = () => {};
  const host: Host = {status:async () => {await gate; return {ready:true, hostId:'host-1', instanceId:'epoch-1'};},
    listProjects:async () => [], createProject:async () => {throw new Error('Pairing must not create a project');}};
  const inbox = new Inbox(':memory:');
  return {inbox, core:new ConnectorCore(inbox, host, () => now),
    pause:() => {gate = new Promise<void>(resolve => {release = resolve;});},
    resume:() => {release(); gate = undefined;}, expire:() => {now += PAIRING_TTL;}};
}

test('declining while host authentication is pending cannot be overwritten by late approval', async () => {
  const f = fixture();
  try {
    const pair = await f.core.pair(origin, 'decline-race'); f.pause();
    const approval = f.core.approvePairing(pair.pairingId, pair.verificationCode, origin);
    f.core.denyPairing(pair.pairingId); f.resume();
    await assert.rejects(approval, {code:'pairing_mismatch'});
    assert.deepEqual(await f.core.pollPairing(pair.pairingId, pair.pollToken, origin), {status:'denied'});
  } finally {f.inbox.close();}
});

test('expiry during host authentication prevents creation of a browser session', async () => {
  const f = fixture();
  try {
    const pair = await f.core.pair(origin, 'expiry-race'); f.pause();
    const approval = f.core.approvePairing(pair.pairingId, pair.verificationCode, origin);
    f.expire(); f.resume(); await assert.rejects(approval, {code:'pairing_expired'});
    assert.deepEqual(f.core.pendingPairings(), []);
  } finally {f.inbox.close();}
});

test('concurrent approvals yield one winner; a later explicit decline revokes its session', async () => {
  const f = fixture();
  try {
    const pair = await f.core.pair(origin, 'double-approval'); f.pause();
    const first = f.core.approvePairing(pair.pairingId, pair.verificationCode, origin);
    const second = f.core.approvePairing(pair.pairingId, pair.verificationCode, origin);
    f.resume(); const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const approved = await f.core.pollPairing(pair.pairingId, pair.pollToken, origin);
    assert.ok(approved.session); f.core.denyPairing(pair.pairingId);
    await assert.rejects(f.core.session(approved.session.token, origin), {code:'unauthorized'});
    assert.deepEqual(await f.core.pollPairing(pair.pairingId, pair.pollToken, origin), {status:'denied'});
  } finally {f.inbox.close();}
});
