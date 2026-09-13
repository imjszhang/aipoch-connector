# Open-Science isolated host rebuild

Verification date: 2026-09-13. This record concerns an isolated development profile, not the
user's normal Open-Science profile or a distributed desktop release. It does not imply all
desktop workflows have been tested.

## Diagnosis

The Open-Science checkout at commit `9abd170b5269c650a9af7e3e3701ab378d05e153` contains the
public `/api/v1/connectors` HTTP routes in `src/main/web-service/http-server.ts` and associated
task application operations in `src/main/web-service/task-api.ts`. Its old `out/main` build did
not contain those routes. Therefore public SDK project/status calls worked while
`listConnectors()` returned HTTP 404 `Task API endpoint not found`.

The existing test process was verified through public CLI `status --config-root … --json`:
PID `12798`, port `64801`, application version `0.28.0`, started at
`2026-09-13T11:49:53.056Z`, `attached: false`. The configured development profile was:

`/var/folders/2y/6y6r_l_14x15j_9ml8j9hdq80000gn/T/aipoch-connector-open-science-i3_wdnya/profile`

The Electron user-data directory is the sibling `electron` directory. This temporary profile
was created specifically for Connector integration. No tokens or authenticated URLs are
recorded here.

## Recovery operations

1. Public CLI `stop` was called with that exact config root and returned `daemon-stopped`.
   No broad process termination or stale-PID signalling was used.
2. Existing `npm run build:e2e` exposed missing local dependency links for declared packages
   `@aipoch/notebook-network-sandbox` and `@aipoch/process-tree-native`. Links were restored only
   under `node_modules`, pointing to the existing packages in this checkout.
3. `process-tree-native`'s existing Node-API binding was built with the installed `node-gyp`.
   This produced only ignored build artifacts; no native source was changed.
4. Repeating the existing build successfully rebuilt `out/main` and `out/preload`, including
   the public Connector routes. Renderer construction exposed additional uninstalled declared
   dependencies, including `i18next` and `react-i18next`. `npm ci --ignore-scripts --no-audit
   --no-fund` restored the exact locked dependency tree (1634 packages), without changing the
   manifest or lockfile.
5. The locked Electron 39.8.10 archive was restored from the existing local cache after checking
   its SHA-256 against that version's npm-distributed `checksums.json`:
   `f7e3ed2cc34dd2eba3f2a95234b576fe8082d35fb133e482102c08105f298572`.
   The standard `npm run postinstall` then passed: upstream patches, Claude ACP patch integrity,
   Prisma Client 6.19.3 generation, both native bindings, and Electron path normalization.
6. The complete existing `npm run build:e2e` passed (main, preload and renderer). Open-Science
   `git status --short` remained empty. Only dependencies and ignored derived artifacts changed.
7. Public CLI `start --config-root … --port 64801 --no-open`, with the same isolated
   `OPEN_SCIENCE_USER_DATA` sibling directory, launched PID `18509`. It did not become healthy
   within the CLI's 30-second observation window. The PID remained live; no duplicate instance
   was launched.

## Final evidence

The rebuilt main bundle contains the public Connector routes. A read-only macOS process sample
of PID `18509` on 2026-09-13 identified startup blocked in `SecItemCopyMatching` /
`SecKeychainItemCopyContent`, consistent with waiting for system Keychain access. No credentials
were read, printed or bypassed by this verification agent. No user profile was used. The same
process later completed startup; the 30-second CLI observation timeout did not indicate exit
and did not cause another instance to be launched.

Public CLI subsequently reported `running: true`, PID `18509`, port `64801`, application
version `0.28.0`, `attached: false`, started at `2026-09-13T12:08:30.180Z`, and the same
explicit temporary config root.

At `2026-09-13T12:13:29.641Z`, Connector's own vendored public SDK was used with that explicit
config root. `listConnectors({ timeoutMs: 15000 })` succeeded with 24 bundled connectors and
0 custom servers; response keys were `connectors`, `customServers`, `reservedCustomServerIds`,
`ncbi`, and `openAlex`. `listProjects({ timeoutMs: 15000 })` also succeeded with 1 integration
test project. Only counts/field names were reported, not settings contents or credential values.

The exact test process remains available to the parent agent for Connector registration and
end-to-end checks. This recovery proves the required public SDK endpoints work on the rebuilt
isolated host; it does not prove Connector registration, tool discovery, browser pairing, or
file acquisition, which have separate integration evidence. Open-Science's tracked worktree
remained clean at commit `9abd170b5269c650a9af7e3e3701ab378d05e153`.

The public CLI offers `--credential-store=os|file` but both CLI and main-process validation
restrict `file` to Linux headless. A non-mutating argument-validation call on this macOS host
returned `--credential-store=file is supported only on Linux.` There is no public memory
backend. No platform spoofing, crypto replacement or user security-setting changes were used.
