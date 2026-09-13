# Local operations and recovery

All commands accept `--data-dir /absolute/owner-only/directory`. A data directory identifies one shared Connector core; multiple MCP sessions use that core. These commands do not start Open-Science or execute research.

## Install, configure and start

Install the reviewed repository build or exact release `.tgz` as described in the README. The current npm package name has not been asserted as published/owned. Node 24.18.1–24.x is required. The pinned public Open-Science SDK/CLI ships inside the package; neither an adjacent checkout nor an independently fetched npm SDK is required.

Run Open-Science yourself, then `aipoch-connector setup`. Setup uses the public SDK to register and enable this exact stdio MCP command and ensures the Connector core is running. An existing registration with different settings is a conflict, not authorization to overwrite it. A new host session may be needed to reload tools. `setup --config-root PATH` selects a specific host profile.

`aipoch-connector serve` runs the core in the foreground for local diagnostics. `status` inspects a running core and reports a credential-free identity/version digest; authentication, discovery-permission and timeout errors remain errors rather than being reported as stopped; `stop` requests only that core's graceful shutdown. `mcp` starts the stdio tool server and ensures the shared core exists. Most operational commands also ensure the Connector runtime exists; `help`, `status` and `stop` do not bootstrap it. A website never launches the host or runtime.

Setup additionally accepts `--origin EXACT_ORIGIN`, `--port PORT`, `--catalog-url MANIFEST_URL` and `--github-client-id REGISTERED_CLIENT_ID`. Origin entries are exact, without a trailing slash/path; production defaults to `https://aipoch.network`. A local development origin is an explicit exception. Setup atomically saves configuration, then compares the active core’s data-directory identity, configuration digest, package/code version and Node version. A mismatch restarts only the authenticated core for that data directory and verifies the replacement. Its output reports `started`, `restarted` or `unchanged` with `configurationApplied: true` only after verification. A restart invalidates in-memory pairings/sessions/action views; durable inbox and operation records remain. A legacy core without verifiable identity returns `runtime_identity_unconfirmed`: inspect and explicitly stop that older core before running setup again. No PID-based termination or cross-directory takeover is performed. The Network adapter currently uses port 47821; changing only Connector's port is not website discovery.

## Pairing without exposing credentials

In Open-Science, `list_connection_requests` reports pending pairing IDs, website origins, short codes and expiration. `review_connection` opens the private local confirmation page for one exact request. The user—not an agent or browser automation—compares the website/code and chooses Connect Open-Science or Decline.

CLI equivalents are `pair list`, `pair review PAIRING_ID`, `pair deny PAIRING_ID`, and the explicit manual `pair approve PAIRING_ID --code MATCHING_CODE --origin EXACT_ORIGIN`. The confirmation URL contains a short-lived private ticket. Do not copy that URL, a runtime token, a poll token or a session token into model context, ordinary logs or bug reports. The short comparison code is intentionally shown to the user.

Pairing expires after three minutes. Approved browser sessions last thirty minutes and are invalidated by host unavailability/change or Connector restart. After expiry or restart, pair again; historical receipts remain local. `stop` invalidates all runtime-memory pairings/sessions without deleting inbox records or stopping workbench research.

## Inbox and project associations

- `inbox list` returns recent receipts and titles; `inbox show REQUEST_ID` returns the exact locally received reference. These outputs can contain research context, so inspect them locally and choose deliberately what to share.
- `projects list` returns the current stable host identity and actual Project IDs. Browser sessions cannot request this list.
- `associate REQUEST_ID PROJECT_ID --host-id HOST_ID` records a Connector association for explicitly selected objects.
- `projects create "Project name" --operation-id UNIQUE_ID --host-id HOST_ID` creates a user-requested project through the host SDK. Preserve the operation ID for recovery.

Through MCP, `create_project`, `associate_reference` and `acquire_github_file` now prepare the exact operation and open a separate local review page. Their immediate result is `waiting_for_user`, not creation/association/acquisition success. The user reviews the captured plan and presses Confirm action or Decline. Agents must not operate that page or use a direct administrative/CLI call to bypass it. The plan includes the applicable source/digest, actual host/project or new file destination; later tool input cannot change it.

After the user's decision, use `get_action_result` with the returned action ID. `pending` means no decision yet, `running` means the operation is in progress, `complete` includes the actual typed result, `declined` means no execution of this action, and `failed` requires examining its result before retrying. The action view expires after ten minutes and is lost on restart; a missing/expired view does not prove there was no side effect. Inspect durable inbox/project mappings, operation records and the exact file destination. Do not automatically create a replacement action or operation ID.

The CLI commands above remain explicit local-owner commands that execute directly. Do not use them as an agent workaround to human review. Project association is not a native host attachment. The pinned SDK lacks a public native reference inbox/GUI attachment operation. Open-Science agents can use the received content through MCP tools. File acquisition, dependency installation and runs are separate decisions; this version only implements the first.

If creation returns `result_unconfirmed` or a host lifecycle error, inspect `projects list` and associate the intended existing project if it is present. Creation and file acquisition journal their operations before side effects; a pending journal record conservatively means the host/disk may have changed. Do not repeat automatically with a fresh operation ID, overwrite the journal or claim rollback. Repeating a completed operation with identical inputs returns its saved result; different inputs under the same ID conflict. CLI acquisition requires an explicit `--operation-id` chosen before execution. Keep that ID for reconciliation; do not generate a replacement after an uncertain result. `operations list` and `operations show OPERATION_ID` query durable records, including after restart. MCP equivalents are `list_operations` and `get_operation`. A `pending` operation has `outcome: unknown` and `retryAllowed: false`; it does not prove failure or non-execution. A completed record includes its saved typed result. These queries never retry or create an operation.

## GitHub access

Anonymous reads require no configuration. `github resolve URL` accepts an existing public repository/tree/blob URL without Network membership. `github preview URL --ref FULL_COMMIT --path FILE` provides the selected regular file's digest. After reviewing source, full commit, license/conditions and destination, `github acquire URL --ref FULL_COMMIT --path FILE --sha256 DIGEST --destination NEW_DIRECTORY --operation-id UNIQUE_ID` writes that file into a new directory. It never overwrites an existing destination or executes a hook/package script. A failed disk write can leave a partial new directory; inspect it explicitly before choosing another action.

Optional device authorization requires a real registered GitHub App with device flow enabled and only the intended repository permissions. Configure its public client ID using `setup --github-client-id REGISTERED_CLIENT_ID`; successful setup verifies that the configuration is active, then use:

```sh
aipoch-connector github auth start
aipoch-connector github auth status
```

`start` returns the user-facing verification URL/code; the human completes authorization on GitHub. The runtime waits locally and stores successful credentials in its own macOS Keychain item. `status` reports state without access/refresh tokens. `github auth cancel` stops local waiting; it does not promise revocation of an authorization already completed at GitHub. `github auth logout` removes the local credential and explains that remote authorization can also be revoked in GitHub settings. MCP offers `github_authorization_status` and `start_github_authorization`; website sessions have neither capability.

The runtime includes refresh handling for expiring credentials when a valid refresh token and configured client ID are available. Expired/revoked/failed credentials require explicit local reconciliation or renewed authorization; no device authorization is initiated silently. Actual GitHub App registration and successful user authorization remain separately verified, not implied by the device-flow tests.

Protected storage currently targets **macOS Keychain only**. The item is scoped by a hash of the Connector data directory and is not an Open-Science credential. There is no plaintext fallback. Other platforms can make public anonymous reads or receive a deliberately supplied `AIPOCH_GITHUB_TOKEN` in the Connector core's environment; they do not have a certified protected login workflow. The environment credential takes precedence while that core is running and is not removed by Keychain logout. Do not place tokens in shell history, source files, MCP arguments or bug reports. Updating an MCP child's environment does not update the already running core; explicitly replace/restart that core to change its environment credential.

## Data, backup and uninstall

Default storage is `~/Library/Application Support/AIPOCH Connector` on macOS and `~/.local/share/aipoch-connector` on other platforms. The latter path does not establish Windows support. The directory must be owned by the current user and inaccessible to other users; existing unsafe permissions are rejected instead of silently widened.

| Item | Purpose |
| --- | --- |
| `config.json` | Selected host profile, exact allowed origins, port and optional App/catalog configuration; no GitHub or daemon token |
| `runtime.json` | Owner-protected discovery URL, PID, instance/directory/config/code identity and administrative token for the currently running core; sensitive and ephemeral |
| `runtime.lock` | Single-runtime ownership record; do not delete while that process is alive |
| `runtime.ensure.lock` | Serializes setup/start/restart for this owner directory; do not delete while its owner is alive |
| `inbox.sqlite` and SQLite sidecars | Durable receipts, exact references, project mappings and uncertain/completed operation records |
| macOS Keychain item | Connector-owned GitHub credentials, separate from these files |

Before backup or upgrade, stop the Connector and confirm it is no longer running; then copy the inbox database together with any remaining SQLite sidecars and configuration to owner-protected storage. Do not publish the backup or copy runtime discovery/locks to another machine. A moved Connector directory changes its Keychain account identity; a moved host profile changes project-association identity. Reauthorize/reassociate explicitly rather than assuming identity continuity.

Upgrade by installing a reviewed version/tarball after stopping the old core; rerun setup if the registered executable path changed, and verify status/tool discovery. Current schema version is 1. A future database version is rejected rather than silently downgraded. Preserve the backup and use the compatible software version; there is no automatic destructive reset or reverse migration.

To uninstall: disable/remove the exact AIPOCH Connector entry in Open-Science, remove local GitHub authorization if used, stop the Connector, and uninstall the installed package (`npm uninstall --global aipoch-connector` for a global npm installation). Disabling MCP alone does not stop a detached shared core. Data and acquired research files are deliberately retained; deleting a reviewed backup/data directory is a separate user choice. Removing the package does not revoke authorization at GitHub.

The isolated final `0.1.0-alpha.1` package was installed and removed through this lifecycle in the implementation task. Its own runtime and 20 MCP tools worked against the rebuilt `0.28.0` development host. Removal used the public SDK to disable/remove only the test MCP entry, logout for an unconfigured local credential state, runtime stop and prefix uninstall. Checks confirmed `packageRemoved: true` and `runtimeStopped: true`, while two receipts, one association, two operations and the acquired file's fixed SHA-256 remained. This is tested data retention, not evidence of revoking a real GitHub authorization. The source CLI registration/runtime was restored afterward for the pending HTTPS check.

## Troubleshooting and support evidence

| Observation | Next step |
| --- | --- |
| Host unavailable | Ensure the intended Open-Science is already running; choose the correct config root and inspect status |
| MCP registration conflict | Inspect the existing exact entry; do not overwrite another command automatically |
| Tools absent after setup | Start a new host session and verify discovery separately from saved registration |
| Wrong origin / cannot pair | Verify exact website origin, port and active configuration; browser local-network restrictions require real testing |
| `catalog_changed` | Refresh/review against the current catalog; align a development preview's manifest instead of bypassing validation |
| Receipt lost or timeout | Inspect local inbox; do not assume nothing was received or auto-resend |
| `runtime_identity_unconfirmed` | Inspect the selected data directory and older core; only an explicit owner stop may migrate a legacy runtime without verified identity |
| Runtime lock after crash | Confirm the recorded process is no longer running; startup recovers a stale dead-process lock. Preserve an invalid lock for diagnosis |
| Existing acquisition target | Choose a new explicitly reviewed directory; do not reset/overwrite existing research |

Ordinary CI and pack-install smoke use synthetic fixtures and temporary directories with no live host. Separate actual checks verified the final package installed into an unrelated prefix: public SDK setup/discovery reported 20 tools, and stdio connection, received-reference and durable-operation queries succeeded. Local in-app-browser reference receipt, synthetic project/file actions, real host restart and isolated package removal with retained data also passed. See [live actions](verification/live-actions.md) and [verification progress](verification/progress.md).

The Connector `v0.1.0-alpha.1` GitHub release is published from `98ad82b246805cdcdf27712c4ffbf05e8f25f44d`; hosted CI/release checks passed 101 tests, and the downloaded tarball matched its published checksum. Network real mode deployed from `e3eb65895b1bebe64f3cefcf18996213bf525313` in successful Pages run `34758098215`; artifact verification, deployment smoke and public HTTPS reads passed. See [the alpha release record](verification/alpha-release.md) and [current acceptance evidence](verification/progress.md). These publication results do not establish a production browser session.

Production browser pairing and real authorization with the user's existing GitHub App remain pending. The App's public Client ID and Device Flow availability await the user. macOS local confirmation opening is implemented; Linux relies on `xdg-open`; Windows automatic confirmation opening is not implemented. These paths do not certify additional browsers, operating systems or an official distributed Open-Science application. Do not use preview port 4190 as a catalog source: Node fetch rejects it under its standard bad-port policy; the verified local website used 4193.

The release workflow validates a matching `v<package version>` tag, checks and packs the project, emits a `.tgz` plus `SHA256SUMS` artifact and creates a GitHub Release. It does not publish to npm. Existing release assets are not silently overwritten on rerun; inspect any partial release before a deliberate repair. A release workflow definition is not evidence that any release has run.
