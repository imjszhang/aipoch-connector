# GitHub source access

GitHub remains the authoritative origin. A repository need not be listed by Network and need
not add an AIPOCH manifest. Reading public repository identity and files uses anonymous requests
unless the caller explicitly injects a token. GitHub authorization never belongs in Network UI.

## API and identity

`new GithubClient({ token?, fetch?, timeoutMs?, maxFileBytes? })` provides:

- `resolve(url, { ref?, path? })`: resolve a repository or tree/blob URL into numeric repository
  ID, canonical repository address, full immutable commit, original ref, optional path and time.
  Explicit ref/path options require a repository URL. Tree/blob URLs test longest matching ref
  prefixes, preserving branch/tag names with slashes and encoded ordinary spaces in file names.
- `list(source)`: list direct entries at the confirmed commit, marking regular files, directories,
  symlinks and submodules distinctly. It does not follow symlinks/submodules.
- `preview(source)` / `getFile(source)`: obtain a selected regular file as bytes, SHA-256, Git
  blob SHA, size and, for bounded UTF-8 text, text. Root/directory URLs require selecting a file.
- `materialize(source, newDirectory, { expectedSha256 })`: obtain the exact reviewed file into
  a new local directory, preserving its repository-relative path. Missing or mismatching review
  digest rejects the action. Existing target directories/files are never overwritten.

`ResolvedGithubSource.license` stays unknown: current repository metadata cannot prove the
license of a historical commit. `repositoryLicenseObservation`, when available, is explicitly
tagged current metadata and must not replace reviewed catalog license/conditions. The consumer
must retain those review fields alongside the resolved source. A copied file does not carry an
automatically inferred permission to execute or redistribute it.

## Content integrity and local writes

Before reading a file, the client rechecks the numeric repository identity to catch URL reuse.
Repository transfers can follow at most three API redirects, all restricted to `api.github.com`.
The full commit is checked again, then Git Trees are traversed to the selected regular blob.
Truncated trees, unsafe paths, symlink traversal, submodules, invalid encodings, oversized files,
and blob content not matching its Git SHA are rejected. The acquired bytes receive SHA-256 too.
The client ignores API-provided download URLs and never contacts arbitrary raw-content hosts.

The file budget defaults to 8 MiB. Each request, including its streamed body, has a 15-second
deadline and a byte bound. GitHub rate limits return `rate_limited` and a delay where provided;
the client does not silently retry. Errors do not echo credentials or provider response bodies.

Acquisition requires a normalized absolute destination path with an existing parent. The parent
is resolved to its real location and the receipt reports the actual destination. New directories
use mode 0700 and regular files 0600, exclusive creation and no-follow flags. No shell, Git hooks,
package installers or repository programs are executed. Failed disk writes may leave a partial
new directory for explicit local inspection; they do not trigger a destructive cleanup/retry.
The higher-level durable action journal must mark uncertain writes for reconciliation.

## Device authorization

`DeviceAuthorization({ clientId, fetch?, timeoutMs?, scopes? })` supports GitHub device flow.
`start()` returns a local-only device code, user-visible code, exact verification URL, polling
interval and expiry. `poll(deviceCode, interval, expiresAt, { signal? })` observes the interval,
increases it after slow-down, and distinguishes declined, expired, cancelled and failed flows.
No client secret is used. Device codes and returned tokens must never be forwarded to Network,
tool output, ordinary logs, or model context.

The client ID must come from an actual registered GitHub App with device flow enabled. No app
registration or working production client ID is embedded or claimed by this module. With a
GitHub App, leave OAuth scopes empty and configure only required repository read permissions
in the App. The app owner's registration and a real user authorization need separate evidence.

Tokens are returned only to the local credential owner. The module neither persists tokens nor
reads host credential files. The integration layer must bind credentials through an approved
credential service or a protected local credential store. It must handle returned token expiry,
explicit revocation, and reauthorization; refresh-token automation is not implemented in this
module. Revoked/expired tokens yield typed HTTP authorization errors on subsequent requests.

## References and verification

- [GitHub device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
- [GitHub App user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [Repository contents semantics](https://docs.github.com/en/rest/repos/contents#get-repository-content)
- [Git Trees](https://docs.github.com/en/rest/git/trees#get-a-tree)
- [Git Blobs](https://docs.github.com/en/rest/git/blobs#get-a-blob)

`tests/github.test.ts` verifies slash refs, direct unlisted sources, real unknown-ref 422 shape,
identity changes, path rejection, hash mismatch, symlinks/submodules, truncated trees, exclusive
non-executable writes, redirect/token boundaries, rate limits and device-flow state transitions.
Tests use synthetic repositories and tokens. Real public reads are distinct from real OAuth
verification; successful unit tests do not claim a registered App or an authorized private repo.

On 2026-09-13, an anonymous real read resolved `imjszhang/aipoch-network` to repository ID
`1367114547`, commit `9858c6925df6fc041c2ad421f3252ccc7fb3c51d`, and acquired `README.md`
in memory through Git Trees/Blobs. It contained 8068 bytes with SHA-256
`70e98039f65f99c6bd7d713c94d73f49c003e7eb793738c8559b2e85e0154fec`. No local research files
or GitHub resources were changed during this read verification.
