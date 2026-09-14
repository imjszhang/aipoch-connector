# Persistent browser authorization 1.0

This additive extension to browser protocol 1.0 restores limited local Connector sessions; it does not authorize reference sending or research execution. Existing pairings and reference envelopes remain protocol 1.0. A website must discover this capability before offering persistence. This document freezes the candidate contract for implementation; release and real-browser acceptance are recorded separately.

## Contract

Every endpoint below requires an allowed exact `Origin`. Responses use Unix milliseconds. `GET /v1/capabilities` returns:

```json
{"protocolVersion":"1.0","persistentAuthorization":{"version":"1.0","connectorId":"installation UUID","algorithm":"ECDSA-P256-SHA256","idleTtlMs":7776000000,"challengeTtlMs":60000}}
```

`connectorId` is a random installation identity stored with authorization records. It survives normal restarts/upgrades. Removing the Connector data directory creates a new identity; an old identity must never be silently replaced in the browser. A persistent grant also binds the authenticated stable workbench `hostId`; each short session still binds its current `instanceId`.

`POST /v1/pairings` accepts existing `{protocolVersion:"1.0",attemptId}` plus optional `browserAuthorization:{version:"1.0",publicKey:{kty:"EC",crv:"P-256",x,y},browserName}`. `x`/`y` are canonical base64url 32-byte coordinates of a valid P-256 point. Additional JWK properties (especially private key material) are rejected. `browserName` is a 1–80 character display hint, not browser attestation. The validated key and name are captured before the pairing code is returned. Later approval cannot replace them.

The local confirmation page shows origin, code, browser hint and public-key SHA-256 fingerprint. Only a pairing offering a valid key shows a default-checked **Remember this browser** option. Unchecking yields an ordinary session. Old pairings have no remember option. Owner CLI/API approval remains session-only unless `remember:true` is explicitly supplied. An approved poll still returns `{status:"approved",session:{id,token,expiresAt,protocolVersion:"1.0"}}` and optionally `authorization:{id,connectorId,origin,browserName,createdAt,lastUsedAt,expiresAt}`. `GET /v1/session` optionally adds `authorizationId`; the short bearer stays only in page memory.

`POST /v1/authorizations/:id/challenge` receives `{version:"1.0",connectorId,purpose:"resume"|"revoke"}` and returns `{challengeId,challenge,expiresAt}`. `challenge` is the exact UTF-8 string produced by `JSON.stringify` of this ordered array:

```json
["aipoch-browser-authorization","1.0","connectorId","exact website origin","authorization id","resume or revoke","challengeId","random nonce",1900000000000]
```

The client must parse and validate every known binding (version, connector identity, origin, authorization, purpose, returned challenge ID/expiry), type/size bounds and expiry before signing these exact bytes with ECDSA P-256 SHA-256. The signature is canonical base64url of the 64-byte IEEE-P1363 signature returned by Web Crypto. Challenges expire after 60 seconds, are single-use, and are held only in the issuing runtime's memory. Restart invalidates them. Concurrent tabs obtain independent challenges. Invalid proof consumes its challenge; a fresh challenge is required.

`POST /v1/authorizations/:id/resume` receives `{version:"1.0",connectorId,challengeId,signature}`. A valid proof plus ready matching workbench returns `{session:{id,token,expiresAt,protocolVersion:"1.0"},authorization:{...}}`. The website verifies that new session through `/v1/session` before displaying Connected. Proof is consumed before asynchronous host authentication; grant state/expiry and current host binding are rechecked before issuing a session. Distinct successful challenges may issue concurrent independent sessions; one proof never issues two sessions.

`POST /v1/authorizations/:id/revoke` receives the same proof shape using a `revoke` challenge and returns `{revoked:true}`. It does not require an available workbench. It durably revokes the grant and invalidates all corresponding live sessions and outstanding challenges. An offline website cannot claim server revocation. Network immediately pauses recovery and discards its persisted credential; a temporary in-memory revocation-only signer attempts delivery. If delivery cannot be confirmed, the page directs the user to local authorization management rather than retaining a hidden automatic-recovery key. Deleting local browser data cannot revoke a server record, but destroys that browser's means of proving possession.

`DELETE /v1/session` ends just that short session, retaining authorization. Network separately persists a paused preference and coordinates its own tabs: refresh while paused must not restore; an explicit Connect may use existing authorization. Forget affects every session/tab sharing that authorization, but not different browser credentials. Sessions are revalidated before each reference operation, so revoked sessions cannot deliver another reference. Revocation cannot undo a reference already durably received.

## Errors and lifetime

Errors retain `{error:{code,message}}`. `connector_changed` (409) rejects a mismatching installation. `authorization_unknown` (404), `authorization_revoked` (401), `authorization_expired` (401), `challenge_expired` (410) and `invalid_proof` (401) are distinct. A valid proof with an unavailable host returns **`authorized_host_unavailable` (503)** without deleting or extending the grant. This code is never returned before proof verification. A different stable workbench returns `host_changed` (409); neither host readiness nor changing browser metadata can transfer a grant. Challenge creation itself requires only the grant, exact origin and connector identity, not a running host. Unknown/unsupported extensions fall back to ordinary explicit pairing without claiming persistence.

Grants expire after 90 continuous days without effective use. Successful approved session issuance, successful recovery and authenticated active-session checks update `lastUsedAt`; failures, capability discovery, challenge creation and revocation do not. Session checks verify expiry before extending use. Clock rollback never moves the last-use value backwards. A stopped workbench invalidates sessions but preserves grants; it cannot keep a grant alive indefinitely. Short sessions remain 30 minutes maximum, regardless of grant touches.

## Local product management

`aipoch-connector authorizations manage` and MCP `manage_browser_authorizations` open a private ten-minute local management page. It lists exact origins, browser hints, key fingerprints, creation/last-use/expiry and state, with per-grant **Forget authorization**. The owner API `GET /admin/authorizations`, `POST /admin/authorizations/manage` and `POST /admin/authorizations/:id/revoke` are not website APIs; they reject Origin and require owner authentication. Management page POST is protected by a private ticket and exact local Origin and submits an explicit grant ID. The private URL is never returned to website APIs or MCP text. Revocation is idempotent; repeat POST cannot restore a grant.

## Threat model and compatibility

The browser stores a nonextractable signing key in IndexedDB, not a persistent bearer. Nonextractability limits direct key export; same-origin malicious scripts can still invoke signing and steal live sessions. HTTPS production origin integrity, dependency review and ordinary origin isolation remain required. Local HTTP acceptance is an explicit loopback development policy, not protection from a malicious local process. The owner operating-system account can access Connector files and is trusted. Full profile/device backups can duplicate credentials; the UI describes a browser credential, not hardware attestation. Browser key deletion/unsupported IndexedDB or crypto/private-mode persistence falls back to session-only pairing with no remembered-success claim. Key rotation requires a new explicit pairing; forgetting the old grant invalidates its old key.

The server stores public keys and authorization records in a separate owner-protected `authorizations.sqlite` database (schema 1), leaving inbox schema 2 unchanged. Installation identity and grants are committed atomically within that database. A new database creates a new identity, so restoration cannot silently trust an unrelated Connector. Older binaries ignore the separate database and cannot restore persistent grants; existing one-session pairing still works. No cloud service, GitHub/daemon credential, private research content, private confirmation ticket, client package or Network internal type is part of this extension.


## Candidate evidence

See [implementation evidence](verification/persistent-authorization.md) for the independent suite and separate real-acceptance status. The public [synthetic interoperability vector](fixtures/persistent-authorization-v1.json) verifies exact canonical challenge bytes without importing either project's implementation.
