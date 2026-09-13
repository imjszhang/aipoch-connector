# v0.1 implementation progress

Checkpoint: **2026-09-13**, package version **0.1.0-alpha.1**. This is a working implementation
record, not a release certificate. Keep exact code, verification and publication states separate.
Later code edits require relevant checks before the final release; do not reuse an earlier pass
as evidence for changed behavior.

## Confirmed observations and checks

| Area | Evidence at this checkpoint | What it establishes |
| --- | --- | --- |
| Public repository and alpha | Public main source `98ad82b246805cdcdf27712c4ffbf05e8f25f44d`; GitHub alpha release published and independently downloaded | [Release verification](alpha-release.md) records exact tag, 101/101 hosted checks and tarball checksum |
| Distribution independence | `npm run build` and `node tests/package-smoke.mjs` passed in the implementation task | Tarball installs into a fresh unrelated directory; CLI help, public SDK imports/integrity and in-memory SQLite work without a runtime/host or neighboring checkout |
| Runtime configuration and ownership | `npx tsx --test tests/runtime.test.ts`: **7/7 passed** after the concurrent-save guard; typecheck passed | Random-port child runtimes in isolated directories verified origin/client/profile/port digest changes, active CORS, durable pending-operation preservation, single startup, scoped restart, legacy refusal and typed CLI status; no real host or the active 47821 runtime was used |
| Latest complete Connector check | Implementation owner ran `npm run check`: typecheck, **100/100 tests**, and build passed after runtime/operation recovery changes | The final operationId preparation-result passthrough subsequently passed **5 targeted checks** and another build; release publication remains separate |
| Actual synthetic local actions and host recovery | [live-actions.md](live-actions.md) records captured-plan browser checks, actual project IDs, exact acquired-file hash, durable receipt/association and real host stop/restart | The isolated implementation-test actions and recovery passed; not real-user consent, production HTTPS or installed-package certification |
| Workflow syntax | CI and Release YAML parsed successfully | Workflow definitions are syntactically readable, not evidence of a hosted run or published Release |
| Public catalog | Anonymous real validation of snapshot `a9fe477dc576ca357c5524cd`; exact counts recorded in [catalog.md](../catalog.md) | The implemented independent consumer read a real consistent public snapshot; not a perpetual freshness guarantee |
| Public GitHub source | Anonymous repository identity, full commit and in-memory README acquisition recorded in [github.md](../github.md) | Direct public GitHub URLs work without special manifests or Network membership; no real OAuth/private-repository claim |
| Isolated real development host | Rebuilt Open-Science development host reported `0.28.0`; public SDK `listConnectors`/`listProjects` work; earlier authenticated project creation/listing evidence is recorded in [open-science.md](../open-science.md) | Actual development-host APIs work in an isolated profile; not packaged-release certification |
| Actual MCP registration/discovery | Built Connector CLI `setup` registered AIPOCH Connector in the independent real host profile; public SDK `testConnector` returned `{success:true,stage:'discovery',code:'ok',toolCount:18}` | Exact real host registration and successful tool discovery, beyond a saved enabled flag |
| Actual stdio MCP invocation | A real stdio MCP client listed 18 tools and called `connection_status`, which returned ready | The actual MCP process communicates with the authenticated real host; not merely a synthetic HTTP fixture |
| Network adapter/state checks | Latest Network run passed **255 checks**; root and subpath browser protocol-fixture runs each passed **6/6** | Final local adapter/site and deployment-path fixture checks passed; production HTTPS remains separate |
| Exact request limits | Network adapter tests passed 19 checks after adding content UTF-8 ≤256 KiB and serialized-envelope UTF-8 ≤260 KiB checks; typecheck passed | Multibyte content and JSON escaping cannot bypass the two limits; this is independent of live bridge availability |
| Network real-mode artifact | Static build passed with 96 pages and 119 files | A real-mode candidate can be built without a running client; it used a local offline snapshot and was not deployed |
| Hosted Network candidate | Fresh candidate workflow [34757888181](https://github.com/imjszhang/aipoch-network/actions/runs/34757888181) succeeded; Network CI [34757788508](https://github.com/imjszhang/aipoch-network/actions/runs/34757788508) and Pages [34758098215](https://github.com/imjszhang/aipoch-network/actions/runs/34758098215) succeeded | Real-mode artifact is deployed; production browser pairing is a separate pending check |
| Network source publication | Adapter source pushed to `main`, commit `e3eb65895b1bebe64f3cefcf18996213bf525313` | Code is on GitHub; a push does not establish real-mode Pages activation or HTTPS transport success |
| Historical browser failure path | Codex in-app browser visited the real local Network page at `http://127.0.0.1:4190` while the host was stopped; no successful connection was claimed | No false Connected state was shown. Port 4190 was later found to be rejected by Node fetch's standard bad-port list, so it is not a usable runtime catalog source or positive transport test |
| Actual local browser pairing and receipt | Codex in-app browser at `http://127.0.0.1:4193` → real Connector bridge on 47821 → rebuilt real `0.28.0` host completed pairing, changed the homepage, retained AnnData selection, and showed Reference received matching the durable inbox | A real local browser/bridge/host reference chain passed; later action/lifecycle checks are recorded below; production HTTPS and other browsers remain unverified |
| Final independent package and MCP | Final tarball installed into an unrelated prefix; its CLI `setup` registered via the public SDK, started that package's runtime, and SDK `testConnector` succeeded with `toolCount: 20`; real stdio listed 20 tools and successfully called `connection_status`, `list_received_references`, `list_operations` | Actual packaged Connector execution against the rebuilt development host, independent of neighboring source repositories; not an official Open-Science installer certificate |
| Isolated package removal and retention | SDK disabled/removed the task's exact MCP entry; unconfigured local credential logout, runtime stop and prefix npm uninstall completed; `packageRemoved: true`, `runtimeStopped: true` | Two receipts, one association, two operation records and the acquired README's exact SHA remained; no claim of tested GitHub credential revocation |
| Additional current-guard resource receipt | Actual resource request `reference-0e3407b5-39c2-4917-8a1c-065b7a3b47eb` returned durable exact-content digest `37d08af4bcf5a3062d40003def2a2852e261b625c9bba8bfb5b81f6e01a7e52a` for snapshot `26b7d31efa5dd84150f48a9c` | A further real resource reference passed the complete current catalog review guard; not just the earlier guard/AnnData flow |
| Multi-source durable HTTP receipt | `npx tsx --test tests/multi-source-receipt.test.ts tests/catalog-review.test.ts tests/core.test.ts`: **18/18 passed** | Frozen real-serializer two-source review passes the actual guard and HTTP bridge, receipt/replay/owner readback, then Core/bridge/SQLite reopening with exact bytes, SHA-256, source order and all metadata preserved; old session authority is rejected and no project is created. This is a synthetic integration check, not a live multi-source catalog/browser observation |

No private tokens, confirmation URLs, actual user research contents or profile credentials are
included in this record. The public source/fixture checks and development-host check are different
scopes and must not be collapsed into “all supported.”

## Real local joint-test record

The implementation task verified this chain on 2026-09-13 using the built Connector CLI and an
independent Open-Science development profile. The public SDK's connector/project listing succeeded
after rebuilding the actual `0.28.0` host. `setup` registered the MCP command, `testConnector`
completed discovery with 18 tools, and an actual stdio MCP client invoked `connection_status`
successfully. This registration used the working-tree build, not an already published release.

The Codex in-app browser then opened the real Network candidate at
`http://127.0.0.1:4193`, completed pairing through the actual `127.0.0.1:47821` bridge and host,
observed the connected homepage replacement, preserved the selected **AnnData** object, reviewed
the complete reference, confirmed sending and received a matching result. The implementation
task compared the UI receipt with the persisted Connector inbox:

| Field | Recorded value |
| --- | --- |
| Request ID | `reference-0421de3e-a411-4b51-9891-430f9561f503` |
| Exact reviewed-content SHA-256 | `b9784cd3d9813c049410a34600247f471d33219a41a2f675bdad3ce0e2404eb5` |
| Catalog snapshot | `26b7d31efa5dd84150f48a9c` |
| Website origin | `http://127.0.0.1:4193` |
| Connector protocol | `1.0`, real loopback transport |
| Host | Rebuilt real Open-Science development host reporting `0.28.0`, independent profile |
| Connector implementation commit | `98ad82b246805cdcdf27712c4ffbf05e8f25f44d`; final source and tag identity, not a claim that the earlier historical receipt ran every later fix |
| Published Network implementation commit | `e3eb65895b1bebe64f3cefcf18996213bf525313` on `main`; this is subsequent source publication, not the asserted build identity of the earlier browser observation |

The exact browser/OS build numbers and final reproducible host-build identity are not recorded in
this checkpoint. This proves the local in-app-browser flow described above, not arbitrary browser
support, an installed Open-Science release, the production HTTPS origin, native host import or
research execution. Subsequent synthetic existing/new project actions, selected-file acquisition and
host restart recovery passed as recorded in [live-actions.md](live-actions.md). Final installed-package
setup, discovery, durable queries and removal with data retention also passed as recorded below. Port 4193 replaced 4190 because Node fetch rejects port 4190 under
its standard bad-port policy; do not disable that policy or use 4190 as the Connector catalog URL.

## Implemented since the initial package checks

The shared core now provides owner-only `/admin/actions` preparation, immutable captured plans,
single-use local human confirmation and result queries. MCP `create_project`,
`associate_reference` and `acquire_github_file` prepare rather than execute. The human confirms or
declines; `get_action_result` reports actual pending/running/complete/declined/failed state. CLI
owner commands remain direct. Creation and acquisition maintain durable operation records so
unknown results are not automatically repeated.

The subsequent durable recovery additions expose `list_operations` / `get_operation`. The earlier real-host observation remains **18** tools; the final independently installed candidate subsequently passed real **20-tool** discovery and stdio invocations. Runtime setup now compares scoped instance/configuration/code identities and verifies a replacement after a configuration change; older unidentifiable cores require an explicit owner stop. CLI acquisition now preserves a caller-provided operation ID.

`tests/core.test.ts` includes an HTTP action-confirmation regression for no-write preparation,
origin checks, single-use approval and the captured result. This entry records the added coverage;
the implementation owner subsequently ran the final aggregate local check at this checkpoint:
typecheck, 100 tests and build passed. The final operation-ID return change then passed five
targeted checks and another build. Independent package smoke and final installed-package
setup/discovery/queries subsequently passed; those are separate observed results.

Optional GitHub device flow, macOS Keychain storage, refresh and local CLI/MCP entry points are
implemented. Credential tests exercise synthetic Keychain/process responses and boundaries.
An actual registered App, real user consent and private-source access have not been certified by
this checkpoint. No Linux/Windows protected credential backend is advertised.

## Final independent installation and local lifecycle

The final `0.1.0-alpha.1` tarball was actually installed into an unrelated prefix. Its own CLI,
vendored public SDK and runtime were used against the isolated rebuilt real `0.28.0` host.
Setup registration succeeded, public SDK `testConnector` reported success with 20 tools, and
an actual stdio client listed all 20 and successfully queried connection status, received
references and durable operations. This is installed Connector evidence, while the host remains
a rebuilt development application rather than an official distributed Open-Science installer.

The isolated-package removal sequence disabled and removed only the task's MCP entry through
the public SDK, ran logout for the currently unconfigured local credential state, stopped that
runtime and uninstalled the package from its prefix. Verification returned
`packageRemoved: true` and `runtimeStopped: true`. The data directory retained **2 receipts,
1 association and 2 operations**. The acquired fixed README still had SHA-256
`70e98039f65f99c6bd7d713c94d73f49c003e7eb793738c8559b2e85e0154fec`.
This proves removal/retention for this candidate, not real OAuth credential revocation.
The source CLI registration/runtime was then restored for the remaining HTTPS joint check.

The additional resource receipt passed the complete current catalog guard with request ID
`reference-0e3407b5-39c2-4917-8a1c-065b7a3b47eb`, exact-content SHA-256
`37d08af4bcf5a3062d40003def2a2852e261b625c9bba8bfb5b81f6e01a7e52a`, and the same
`26b7d31efa5dd84150f48a9c` snapshot. Both earlier and current-guard receipts remain distinct
records. Synthetic action checks, local host restart and package removal do not authorize
agents to approve product actions on a research user's behalf.

## Remaining acceptance

1. **Complete production browser pairing.** Real-mode Pages deployment, independent artifact
   review, public HTTPS build-info/manifest and release smoke passed. The production page now
   loads in native Chrome; starting the selected AnnData connection reached Chrome's local-app
   access permission prompt. User approval is pending. After approval, verify the actual origin,
   pairing, reviewed reference and durable receipt without bypassing browser permissions.
2. **Finish existing-App authorization.** The public Client ID and Device Flow setting await
   the user. Real consent and authenticated access remain unverified; public anonymous reads and
   synthetic credential tests do not establish them.
3. **Keep compatibility claims bounded.** The installed Connector was tested against the rebuilt
   Open-Science development host. Additional browsers, official host installers and operating
   systems are future compatibility checks before advertising support, not permission to infer
   support from fixtures.

Published source, 101-test hosted CI, release artifact/checksum and real-mode Pages deployment
are complete. Documentation changes do not require repeating the already-passed implementation
checks. New code changes require the relevant validation.

## Resume without losing the product boundary

- Read `AGENTS.md`, the implementation plan, [protocol](../protocol.md),
  [operations](../operations.md) and the Network v9-r2 paired design before changing behavior.
- Keep Network static and independent. Do not add GitHub authorization UI, full private project
  listing, an Open Open-Science action, personal cloud sync or automatic research execution.
- Runtime discovery files, Keychain contents and local confirmation tickets are sensitive.
  Do not print or commit them when reconstructing a test session. Discover only the explicitly
  selected runtime/profile and avoid starting a duplicate bridge on port 47821.
- Real fixture tests, live failure-path checks, approved end-to-end behavior and production
  releases have separate statuses. Update this file with exact new evidence rather than marking
  all phases complete from one successful command.


## Published state and outstanding user inputs

The public alpha source, tag, hosted 101-test checks and independently downloaded tarball are
verified in [alpha-release.md](alpha-release.md). Network deployed real mode from
`e3eb65895b1bebe64f3cefcf18996213bf525313` in successful run `34758098215`. Its public
HTTPS build-info and manifest returned HTTP 200: protocol `1.0`, endpoint
`http://127.0.0.1:47821`, snapshot `26ba825d9cdfbeeabbdb7b98`. The source refresh, archive
and full file tree were independently verified before dispatch. This is publication and HTTP
verification, not production browser session evidence.

The in-app browser could read and operate the real local website, but attempts to navigate to
the production HTTPS page timed out twice at 30 seconds and once at 60 seconds. Existing tabs
remained on the local page or about:blank, so no production pairing was inferred. The Codex
open-page tool subsequently returned `queued`; the user was asked to bring this task forward
and let the queued production page load. Native Codex app inspection was disallowed by the
computer-use tool and was not bypassed. No browser warning or permission was dismissed.

The user chose an existing GitHub App. Its public Client ID and Device Flow availability are
still required for real authorization; no credentials have been requested or fabricated.
Local public-source use remains verified. These two pending checks prevent declaring the
complete implementation goal fully accepted, despite the published alpha and Pages artifact.

Subsequent observation: the production in-app-browser tabs acquired the expected page title/URL,
but selecting either still timed out. Chrome browser-provider control was unavailable, while
the permitted native Chrome interface successfully loaded `https://aipoch.network/`. Its actual
page showed **Not connected** without a Demo label. Selecting **Connect to open: AnnData** retained
AnnData in the Open-Science panel; choosing **Connect Open-Science** reached Chrome's permission
prompt to access other apps and services on this device. The implementation task requested the
user's approval and left that prompt unanswered. This establishes the HTTPS page and permission
boundary, not approved pairing or receipt. The isolated host and existing Connector were queried
and remained ready; no duplicate runtime was started.

The documentation commits `2e05ea746545b81db4c644855b101f8723a41acc` (Connector) and
`2db16872949eec6688ab7ae65beab9669fc4ed24` (Network) subsequently passed their hosted checks in
runs `34758747678` and `34758747510`, respectively. These are distinct from the released tag and
deployed artifact identities recorded above.
