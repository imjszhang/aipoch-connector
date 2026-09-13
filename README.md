# AIPOCH Connector

AIPOCH Connector brings research discovered on [AIPOCH Network](https://aipoch.network/) into a running Open-Science workbench. It is independent local software: a small shared runtime, MCP tools, a browser pairing bridge, and a durable reference inbox.

GitHub remains the source of code, documentation, identity and collaboration. Existing public repositories work without an AIPOCH manifest or prior Network membership. Network stays a static, anonymously useful website; it does not receive GitHub credentials or the Open-Science daemon token.

**Source version: `0.1.0-alpha.2`.** [GitHub releases](https://github.com/imjszhang/aipoch-connector/releases) contain published packages. The previous `0.1.0-alpha.1` release established the following verification evidence. Hosted CI and release checks passed 101 tests; real local installation, 20-tool discovery, reference receipt, project association, file acquisition and recovery were verified against an isolated Open-Science development host. The [production Chrome/macOS flow](docs/verification/production-browser.md) also passed pairing, reviewed resource delivery with a matching visible/durable receipt, disconnect and receipt retention after a Network recovery fix. [Real GitHub App authorization](docs/verification/github-authorization.md), macOS Keychain readback and authenticated public-source reads passed. The package name `aipoch-connector` is a candidate name, **not a claim that this project is published on npm or owns that registry name**. Do not install by the bare registry name on the basis of this README. Use this checkout or a reviewed release tarball.

## Install

Use **Node.js 24.18.1 or a later 24.x release**; Node 25 is outside the declared range. No neighboring Open-Science or aipoch-network checkout is required.

From this repository:

```sh
npm ci
npm run check
npm pack --ignore-scripts
npm install --global --ignore-scripts ./aipoch-connector-0.1.0-alpha.2.tgz
aipoch-connector help
```

Download the release’s exact `.tgz` and `SHA256SUMS` from [GitHub Releases](https://github.com/imjszhang/aipoch-connector/releases), verify the downloaded checksum, then install that local `.tgz` with the same install command. Installation resolves the declared runtime dependencies through npm; it does not install or start Open-Science. There is no automatic npm publication workflow.

The public Open-Science SDK/CLI is pinned and included under `vendor/open-science` because that SDK was unavailable from npm when integrated. It is **Apache-2.0**, separate from this project's MIT license. The desktop application, private settings and research data are not included. See [third-party notices](THIRD_PARTY_NOTICES.md) and [host compatibility](docs/open-science.md).

## Connect a running workbench

1. Open and configure Open-Science yourself.
2. Run `aipoch-connector setup`. It registers/enables the exact MCP command through the public host API and starts the shared Connector runtime if needed. It never launches Open-Science. With multiple workbench profiles, use `setup --config-root /absolute/path/to/the/chosen/profile`.
3. Start a new Open-Science session if the current session already loaded its tool list. Registration alone does not prove tool discovery; check the AIPOCH Connector tools are available.
4. On a Network build with real connection support, choose **Connect Open-Science**. The website displays a short connection code.
5. In Open-Science, ask to review the pending Network connection. The agent uses `list_connection_requests`, then `review_connection` for the exact request. A separate local confirmation page shows the website origin and code. **You compare them and click Connect Open-Science or Decline.** The tool opens the page; it cannot approve it, and agents must not click approval for you.
6. Return to Network. Once the authenticated workbench is verified, the website becomes connected. Select a project or capability, review its complete reference, and explicitly send it.

If a browser does not open the local confirmation page, use `aipoch-connector pair list` followed by `aipoch-connector pair review PAIRING_ID`. CLI users who have compared the exact website and code can instead run `pair approve PAIRING_ID --code MATCHING_CODE --origin https://aipoch.network`. Never paste tokens or the private confirmation URL into a chat.

The Connector uses `http://127.0.0.1:47821`. Only `https://aipoch.network` is allowed by default. A development website must be explicitly added, for example `aipoch-connector setup --origin http://127.0.0.1:4186`; successful setup verifies the active configuration and restarts that same data-directory core when required. Pair again after a restart; durable receipts remain. An older core without verifiable runtime identity requires an explicit owner stop before setup. Changing `--port` does not change the Network website's fixed endpoint. HTTPS-to-loopback browser support remains subject to actual browser verification; a failed connection does not prove Open-Science is uninstalled.

## Continue with the received research

`list_received_references` and `get_received_reference` read the local inbox. Use `list_projects` to select an actual workbench Project ID, then explicitly request `associate_reference`; or explicitly request `create_project` before association. The three MCP write tools—`create_project`, `associate_reference` and `acquire_github_file`—capture the exact proposed action and open a separate local confirmation page. They initially return `waiting_for_user`, without performing the write. You review the target/content and confirm or decline there; the agent must not operate this page for you. It then uses `get_action_result` to read the actual result. After an expired action view or restart, `list_operations` / `get_operation` inspect durable creation/acquisition records; an unknown outcome is never an automatic retry. Explicit local-owner CLI commands remain direct operations.

**Received means durable Connector storage.** An association is a Connector mapping to a verified Open-Science Project ID, not a native host attachment, a clone or an executed task. The current host SDK has no generic native reference-inbox UI. References are available to the workbench through MCP tools. Catalog projects and the user's workbench projects remain different objects.

GitHub tools resolve existing URLs, list fixed-version files, preview a selected regular file and its SHA-256, and acquire that file into a **new** destination after explicit approval. They do not clone or synchronize complete repositories, overwrite files, install packages or run research. Public reads work without GitHub authorization. For optional device authorization with macOS Keychain storage, ordinary users can reuse the registered [AIPOCH Connector GitHub App](https://github.com/apps/aipoch-connector); registering another App is unnecessary:

```sh
aipoch-connector setup
aipoch-connector github auth start
aipoch-connector github auth status
```

These simplified commands apply from `0.1.0-alpha.2`; the older `0.1.0-alpha.1` tarball needs `setup --github-client-id Iv23liAWWYs4LOqm1YAg`. Run these after installation with Open-Science already open, then personally complete GitHub's authorization. The public Client ID `Iv23liAWWYs4LOqm1YAg` is the default when no override is configured, including for existing configurations. Authorization still requires your consent. The `--github-client-id` setup option remains available for another registered App with Device Flow enabled and suitable read permissions. See [operations](docs/operations.md), [GitHub boundaries](docs/github.md) and the [real authorization record](docs/verification/github-authorization.md).

Website Saved/Recently viewed remain browser-local. The Connector does not migrate or synchronize them and never exposes the entire private project list to a website.

## Development and verification

```sh
npm run check
node tests/package-smoke.mjs
```

These checks use synthetic host/HTTP fixtures and isolated temporary files. They require no running Open-Science, live GitHub credentials or adjacent repository. The package smoke test installs the packed artifact in a fresh directory and verifies the CLI and vendored distribution. It needs npm dependency access but does not start a runtime or host.

Before publication, the local Connector check passed typecheck, 100 tests and build; the final operation-ID return change passed five targeted checks and another build. The released implementation then passed 101 hosted tests. Independent package smoke and a real installation into an unrelated prefix passed. That installed `0.1.0-alpha.1` package registered through the public SDK against the rebuilt Open-Science `0.28.0` development host, started its own runtime, exposed 20 MCP tools, and successfully queried connection status, received references and durable operations.

Local in-app-browser reference receipt, actual project association/creation, exact acquired-file bytes and host restart recovery also passed using synthetic implementation-test actions. Uninstalling the isolated package stopped its runtime while preserving two receipts, one association, two operation records and the acquired file's verified hash. Network's receipt-recovery update passed 283 unit checks and its complete browser matrix, including 12 real protocol checks each for root/subpath builds, then deployed through verified Pages artifacts. Actual production Chrome pairing, a separately reviewed resource receipt with matching history/durable digest, disconnect and receipt retention passed. The earlier unconfirmed project delivery remains recorded separately and was not resent. Real user authorization through the newly registered App, fresh-process macOS Keychain readback, authenticated identity/public-source reads and live-core resolve/preview also passed. Additional browsers, operating systems, distributed Open-Science installers, private repositories and live refresh/revocation have no inferred compatibility claim. See the [current evidence and scope](docs/verification/progress.md).

- [Product boundaries](docs/product-boundaries.md)
- [Browser protocol](docs/protocol.md)
- [Network design integration](docs/network-integration.md)
- [Operations, recovery and uninstall](docs/operations.md)
- [Implementation plan and evidence](docs/implementation-plan.md)

Original code is [MIT](LICENSE). Upstream projects and vendored components retain their own licenses.

Publication and downloaded checksums are recorded in [the alpha release verification](docs/verification/alpha-release.md).
