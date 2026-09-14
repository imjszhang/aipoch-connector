# Alpha.4 local HTTP acceptance — 2026-09-14

Status: implemented, reviewed, merged and published. Local/hosted checks, installed-package
acceptance, browser transport fixtures and original downloaded-release verification passed.
The full real Network + human-approved host chain remains outside this new evidence, as detailed below.

## Scope and compatibility

Implements [the reviewed plan](../default-loopback-http-plan.md) in PR #4. Defaults permit
canonical HTTP origins with exactly `localhost`, `127.0.0.1` or `[::1]` at any port; explicit
origins remain additive. `allowLoopbackHttp: false` / `setup --loopback-http deny` disable the
implicit rule. Missing legacy fields use true without rewriting old files. Runtime digests,
scoped restart and exact origin/session boundaries preserve their existing roles. Schema stays 2.

The setting does not widen `/admin/`, localhost binding, GitHub/catalog transport validation,
canonical `public_location` or exact reviewed content. Local browser origin and publication
location remain different fields. Existing alpha.3 acquisition replay and package-version tests
remain required.

## Before-change evidence

- New configuration regression failed because `allowLoopbackHttp` was undefined rather than true.
- New direct HTTP loopback tests failed with `origin_denied`; the existing explicit-list-only
  bridge behavior passed. These failures precede the corresponding implementation.

## Automated and installed-package gates

- Final `npm run check`: typecheck, **118/118 tests** and build passed on Node 24.18.1.
- Final `node tests/package-smoke.mjs`: independently installed alpha.4, verified pinned SDK,
  CLI recovery and actual stdio MCP product version/20-tool discovery/read, then the new
  synthetic public SDK HTTP acceptance passed. No neighboring host or network checkout is needed
  for these default checks.
- New configuration tests cover missing/new defaults, explicit false, non-mutating legacy reads,
  default arrays, effective digest equivalence, normalized saves and invalid-value rejection before
  replacing the original file. The latter closes an independent review finding in shared saving.
- Origin/bridge tests cover exact protocol/host/port parsing, aliases/malformed values, explicit
  exceptions, preflight/actual agreement, no wildcard CORS and unchanged owner isolation.
- The source and installed helper both execute real CLI setup against an isolated public SDK HTTP
  host fixture: nine local origins (three hostnames, two random ports plus default port), production
  origin, invalid sources, allow/deny/invalid/no-flag persistence, controlled restart, expired old
  pairing/session authority, durable exact reference digest, association and pending/complete
  operation retention. No actual host is launched or user approval bypassed.
- Direct bridge/catalog tests additionally verify canonical production `public_location` from local
  sessions and reject changed location/snapshot/source/license/conditions. Different origin DELETE
  retains the prior idempotent success response but cannot revoke the original session.
- During parallel development one isolated rerun reported `runtime_configuration_changed` while
  source code was being edited. It was not retried as an uncertain write. A subsequent clean,
  stable-source test run passed, as did the final aggregate and package gates.

## Browser evidence and remaining real-host scope

[Real browser transport report](alpha4-browser.md): at `2026-09-14T09:13:54.422Z`, installed
Google Chrome **152.0.7977.84** (headless, fresh profile) on macOS **26.6.2**, Playwright **1.63.0**,
passed actual browser-generated Origin/CORS checks for localhost ports 56346 and 56354,
127.0.0.1 port 56359, and IPv6 [::1] port 56364. Each preflight returned 204, pairing POST 200
and pending poll; no session credential returned 401. Cross-origin polling was rejected, browser
admin actual/preflight were rejected, disabling the policy blocked all four sites, and an explicit
single-origin exception worked. No DNS mapping, Origin injection or web-security bypass was used.

The optional `tests/browser-loopback.mjs` needs an independently installed Playwright module
(`PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs`) and `BROWSER_CHANNEL=chrome` for
this browser. It adds no browser dependency to the runtime or default package test. All pairings
remained pending; the fixture performed no research operation and held no personal host profile.

The full real Network preview + user-started Open-Science + human comparison/approval + reviewed
Send flow has not been rerun for alpha.4. Historical real host/browser evidence remains historical.
Without those user/environment steps, no new complete real-host/browser compatibility claim may
be inferred from the automated fixtures. The plan permits merge/release with this limitation
explicitly recorded; it does not permit calling that full live chain verified.

## Publication and downloaded-original acceptance

- [PR #4](https://github.com/imjszhang/aipoch-connector/pull/4) merged at `2026-09-14T09:19:33Z`
  as `3ef23c6950b85f0557ed17f9d04d6f3efea1be06`.
- PR checks `34827145579` and `34827149210`, main checks `34827321417`, tag checks
  `34827361194`, and release workflow `34827361201` all succeeded. The release log explicitly
  reports 118/118 tests plus independent installed-package acceptance.
- [Release v0.1.0-alpha.4](https://github.com/imjszhang/aipoch-connector/releases/tag/v0.1.0-alpha.4)
  was published at `2026-09-14T09:21:05Z`; its annotated tag identifies the merged commit above.
- Original downloaded asset: `aipoch-connector-0.1.0-alpha.4.tgz`, **236081 bytes**.
- Independently computed SHA-256 matched `SHA256SUMS` and GitHub's asset digest:
  `a060319866fbe5b2339c1f1609ee64ed54770f912d668bc3391af9e808089178`.
- `node tests/package-smoke.mjs /absolute/downloaded.tgz` independently installed the original
  asset and passed SDK integrity, CLI help/inbox, acquisition replay/restart/no-overwrite/unknown
  recovery, stdio version/20-tool/read, default/disabled local origins, CLI setup, origin/session
  isolation and retained durable receipt/associations/operations after controlled restart.

This source follow-up adds publication evidence to the immutable pre-publication documentation
inside the asset. No tag or release asset was overwritten. No npm publication, Network deployment,
active user runtime upgrade or host launch was performed. Local main is synchronized with the
published implementation and this evidence follow-up; no real-host compatibility is inferred.
