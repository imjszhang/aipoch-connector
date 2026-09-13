# Open-Science integration

The host adapter uses the public Open-Science SDK and CLI. It does not import Electron,
private RPC channels, application databases, or credential/configuration-file readers.
Open-Science remains independently installed, configured, and released. Connecting from
the Network website never launches a host or starts a research run.

## Distribution and compatibility

The source inspected for this integration is Open-Science commit
`9abd170b5269c650a9af7e3e3701ab378d05e153`, application version `0.28.0`.
Its public `@aipoch/open-science` package is version `0.1.0`, Apache-2.0.
The npm registry returned 404 during initial integration on 2026-09-13. The exact public
SDK/CLI distribution is therefore copied to `vendor/open-science`, independently of any
neighboring checkout. `ORIGIN.json` pins the source commit and SHA-256 of every upstream file.
`index.d.mts` is an exact copy of the upstream declaration for NodeNext resolution.
Upstream source files are not modified. See `THIRD_PARTY_NOTICES.md` and the bundled license.

The package's declared Node minimum does not establish Connector platform support. Connector
has its own runtime requirements. A later switch to a published SDK must preserve contract
tests and deliberately update the compatibility evidence; do not follow upstream HEAD or npm
`latest` during end-user installation.

The normal application installer owns the desktop runtime. Open-Science's public CLI can be
installed from Settings → General → Command line tool. Debian packages install their own CLI.
The upstream npm CLI requires an installed application and is not a standalone host runtime.
Vendoring this client does not vendor or install the Open-Science application.

## Host readiness and identity

`OpenScienceHost` accepts an optional absolute `configRoot` and loopback `baseUrl`. With no
profile, the public SDK/CLI discovery chooses a healthy development or production profile.
For multiple installations, choose a specific profile. A supplied URL is only an endpoint
constraint: it must match the discovered authenticated local instance. It never redirects
the host token to another service. Arbitrary hosts, credentials in URLs, and URL paths are rejected.

The SDK's public `health()` result does not define a host startup identifier. The adapter runs
the public distributed CLI `status --json`, which authenticates its health request and reports
the service's profile, PID, port and startup time. The adapter uses those results as follows:

| Field | Meaning |
|---|---|
| `hostId` | SHA-256 of the selected configuration-root identity. Stable across host restarts; used with the actual host Project ID for persistent associations. Moving/renaming a profile requires explicit reassociation. |
| `instanceId` | SHA-256 of profile, PID, port and `startedAt`. Identifies the current service lifetime and invalidates browser sessions on host restart/change. |
| `ready` | Public authenticated host connectivity and startup identity were verified. It does not mean an AI provider is configured or that research execution is ready. |
| `version` | Application version reported by authenticated SDK health. |
| `reason` | A bounded reason code; raw SDK errors, private paths, and credentials are not returned. |

Readiness probes compare CLI lifecycle information before and after SDK health. Host operations
also check the lifecycle after completion. An absent host, failed authentication, invalid status,
or changing instance is not reported as connected. No PID is signalled, and a PID alone is never
treated as proof of an authenticated service. The browser sees only opaque hashes, not profiles,
PIDs, daemon URLs or tokens. A host configuration backup restored at a new path is a new identity.

The upstream lifecycle metadata is not an atomic `If-Host-Instance` write precondition. A host
restart while a request is in flight therefore creates an uncertain outcome, not an exactly-once
guarantee. The Connector core must expire old sessions and retain the corresponding operation
record for reconciliation.

## Available operations and boundaries

- `status()` checks authenticated local connectivity without starting the host.
- `listProjects()` returns only actual host project IDs and names. The core must keep this list
  on trusted local surfaces; do not expose all local projects to the public website.
- `createProject()` forwards the reviewed name/description and original idempotency key. It does
  not write Agent Context, attach arbitrary files, open a window, or start an agent.
- `registerMcp()` registers and enables the exact stdio command through public connector APIs.
  Repeating an identical configuration is safe. A different existing command/configuration is
  a conflict, not permission to overwrite it. A successful registration proves saved configuration,
  not tool discovery, an active MCP process, or website connectivity. Confirm discovery separately.

Only `src/workbench` imports the SDK. The constructor's optional second dependency object supports
an injected narrow client and lifecycle provider for tests. Production callers use SDK discovery
and the public CLI. There is no constructor option for a daemon token.

The host SDK has no public `attachReference`, persistent research-reference inbox, or
`openProjectInGui` API at the pinned version. The v0.1 association is therefore a durable Connector
mapping to a verified host Project ID; received references remain available through Connector MCP
tools. It must not be described as a native Open-Science attachment or native inbox entry.
Getting files at a pinned commit is a separate Connector operation. Neither a mapping nor file
acquisition implies installation or execution. Repository working directories only enter host
execution when the user later explicitly requests a run with that directory.

For native GUI reference management, add a small **generic public host capability** with a
versioned attachment/reference contract, explicit target Project ID, provenance metadata,
idempotent receipt and a reviewed navigation action. That future capability belongs in the host
adapter compatibility layer. Do not reach into host database tables or private IPC, and do not
fake receipt by starting a run or rewriting Project Agent Context.

## Writes and recovery

The upstream SDK's idempotency registry is process-local, retained for up to 24 hours while that
daemon remains alive. A restart loses the replay guarantee. Connector must persist its own exact
request, content digest, host identity, target and result before claiming an association.

The adapter never automatically retries a write. A request error or lifecycle change after
submission returns `host_outcome_unknown`. The core must retain that state, query/reconcile a
known returned project when possible, or let the user select the intended existing project.
Do not silently create another project. A host write failure can be conservatively unknown even
when the server may have rejected it; this avoids unsupported claims about partial operations.
Stopping a local wait does not cancel a remote operation.

MCP registration first reads the current connector configuration. If that read fails, no write
was submitted: missing public endpoints return `host_api_unsupported`, and other read failures
return `host_unavailable`. An uncertain-write result only applies after an add/enable request
was submitted. A matching already-enabled entry also needs no write.

## Credentials

The SDK/CLI discover daemon authentication locally; secrets never enter Network browser sessions.
Public credential creation returns an opaque ID, not a readable secret. Environment/header
credential IDs can be bound to MCP configuration. Such a binding reaches a newly launched MCP
process; it does not automatically update a separately running Connector core's credentials.
Credential provisioning must include a deliberate core lifecycle and revocation strategy before
claiming authorization works. Do not reuse Open-Science's Skill-import-only GitHub token as a
general repository credential or read protected internal records directly.

## Verification

`node --import tsx --test tests/workbench.test.ts` covers lifecycle changes, stable project identity,
endpoint restrictions, no implicit execution, idempotency-key forwarding, uncertain write recovery,
MCP configuration conflicts, and vendored file integrity. Its isolated HTTP integration fixture runs
the actual vendored SDK and public CLI with temporary credentials and a synthetic public host API.
This establishes client/API integration, not compatibility with a real desktop release.

Real-host verification must use an isolated development configuration and Electron user-data
directory, or a user-selected installed host. Never borrow or modify the user's existing research
profile for a fixture. Record the actual build/version and observed project/MCP behavior separately.

On 2026-09-13, an existing local Open-Science development build reporting `0.28.0` was started
through the upstream public source CLI with a fresh temporary `configRoot`, separate
`OPEN_SCIENCE_USER_DATA`, an unused loopback port, and `--no-open`. The actual Electron headless
host—not the synthetic HTTP fixture—passed this adapter's authenticated readiness, explicit
project creation with an idempotency key, and subsequent listing of that exact Project ID.
No research run was started. The installed application package and a PATH-installed CLI were
not available on this machine; this is development-build evidence, not packaged-release
certification. The existing build's application version was verified, but its artifacts do not
establish that every byte was built from the pinned SDK source commit.

The subsequent joint check rebuilt the actual `0.28.0` development host and verified the public
SDK's `listConnectors` and `listProjects` operations. Running the built Connector CLI's `setup`
against the independent profile successfully registered AIPOCH Connector. Public SDK
`testConnector` returned `{success:true,stage:'discovery',code:'ok',toolCount:18}`. An actual stdio
MCP client then listed 18 tools and invoked `connection_status`, which reported the authenticated
host ready. These are real registration/discovery/invocation results, not inference from an
enabled setting. They concern the working-tree build, not a published installed package.

The same joint check used the Codex in-app browser at `http://127.0.0.1:4193`, the actual Connector
bridge on port 47821 and the rebuilt real host. Pairing succeeded; the website replaced its public
homepage, preserved the selected AnnData object, showed the complete review, and confirmed an
explicitly sent reference with a receipt matching durable Connector inbox storage. Request
`reference-0421de3e-a411-4b51-9891-430f9561f503` has exact-content SHA-256
`b9784cd3d9813c049410a34600247f471d33219a41a2f675bdad3ce0e2404eb5` against catalog snapshot
`26b7d31efa5dd84150f48a9c`. See [the joint-test record](verification/progress.md) for its scope.

A subsequent real resource reference passed the complete current catalog review guard:
request `reference-0e3407b5-39c2-4917-8a1c-065b7a3b47eb`, exact-content SHA-256
`37d08af4bcf5a3062d40003def2a2852e261b625c9bba8bfb5b81f6e01a7e52a`, snapshot
`26b7d31efa5dd84150f48a9c`. Synthetic captured local project association/creation, exact file
acquisition and actual host stop/restart are recorded in [live-actions.md](verification/live-actions.md).
These local action/lifecycle checks have passed; they are not product consent on behalf of a user.

The final Connector `0.1.0-alpha.1` tarball was then installed into an unrelated prefix. That
installed CLI registered through the public SDK and started the installed package's runtime.
SDK `testConnector` succeeded with `toolCount: 20`; a real stdio client listed 20 tools and
successfully called `connection_status`, `list_received_references` and `list_operations`.
The 18-tool result above remains the historical earlier-build observation. The 20-tool result
verifies the final installed Connector against the rebuilt `0.28.0` development host; it does
not establish compatibility with an official distributed Open-Science installer.

The isolated installation was then removed: public SDK disable/remove of the exact task MCP
entry, logout in the unconfigured credential state, runtime stop and prefix npm uninstall.
Both package removal and runtime shutdown were verified, while two receipts, one association,
two durable operations and the acquired README's SHA-256 remained intact. Its digest stayed
`70e98039f65f99c6bd7d713c94d73f49c003e7eb793738c8559b2e85e0154fec`.
This is observed installed-package lifecycle/data retention, not real OAuth revocation. Source
CLI registration/runtime was restored afterward for the remaining production HTTPS check.

The original local preview port 4190 is rejected by Node fetch's standard bad-port policy and
cannot be used as the runtime's catalog source; the successful local chain used 4193. This does
not justify disabling browser/fetch protections. The subsequent production Chrome/macOS check
paired with this rebuilt development host and, after Network receipt recovery deployed, verified
a separately reviewed resource's visible receipt/history against its stored original-content
digest. Same-session Disconnect restored public state, and a later owner read/hash confirmed
durable retention. The earlier unconfirmed project submission remains a distinct historical
result and was not resent. See [production-browser.md](verification/production-browser.md).

Other browsers, operating systems and official host installers still require their own
compatibility evidence. Real GitHub App authorization awaits the user's existing App public
Client ID and Device Flow availability. The successful production retest used Network
`bf4b365f1fff865e60bd76a6d0de20ccf5ec64db`, following its initial real-mode publication at
`e3eb65895b1bebe64f3cefcf18996213bf525313`; the published Connector alpha source is `98ad82b246805cdcdf27712c4ffbf05e8f25f44d`.
The pinned SDK source commit must not be presented as either implementation commit or the
rebuilt host's complete artifact identity.

No generic native GUI inbox/attachment API is claimed. No browser, operating system or application
release should be advertised as supported solely because a fixture or unit test passes.
