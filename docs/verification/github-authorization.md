# Real GitHub App authorization verification — 2026-09-13

**Status: real App registration, user authorization, protected-store readback and authenticated
GitHub reads passed.** The user changed the earlier existing-App preference and
explicitly registered a new AIPOCH Connector GitHub App. The user personally submitted the final
registration and the final GitHub authorization consent. The Connector subsequently reported
`authorized`. A fresh process independently retrieved its protected credential and performed
authenticated identity/repository reads; the live Connector core separately matched the resolved
source and preview. This closes the real-App acceptance in P2 for the tested macOS/public-source
scope.

## Public App identity and settings

| Field | Verified value |
| --- | --- |
| Public App | [AIPOCH Connector](https://github.com/apps/aipoch-connector) |
| Owner / slug | `imjszhang` / `aipoch-connector` |
| GitHub App ID | `4931416` |
| Public Client ID | `Iv23liAWWYs4LOqm1YAg` |
| Repository permissions | Contents: read; Metadata: read |
| Device Flow | Enabled; observed in the native Firefox settings UI |
| Webhook | Disabled; observed in the same settings UI |

The public App identity and permissions were checked through the GitHub API. Registration and
authorization were distinct user actions. The implementation task filled the user-facing
verification code on GitHub, then stopped at the final **Authorize** control for the user to approve. This record
contains no device code, user code, token, client secret, private key or private confirmation URL.

## Connector configuration and authorization observation

The existing isolated Connector was configured through its public CLI `setup` with the App's
public Client ID. The setup subprocess had `AIPOCH_GITHUB_TOKEN` unset, so the restarted core
used this local authorization rather than an environment credential. Setup verified the active
configuration and restarted that same core. It did not change Connector production code,
package/schema, the existing release tag or CI setup.

| Field | Observed value |
| --- | --- |
| Package / protocol | `0.1.0-alpha.1` / `1.0` |
| New process / runtime ID | PID `35716` / `b9df9144-18d6-42f1-bca9-35d76dd4c3b6` |
| Configuration SHA-256 | `024199d5ae54fd49c60a87e0b4cb1745cee603efdc4a7f6f085475ba1e17431c` |
| Unchanged runtime code SHA-256 | `f4a21a366cbf3e0ac8910a153464cb6241ce572900170c4da912cb48513abc07` |
| Host | The same rebuilt Open-Science `0.28.0` development host remained authenticated and ready |
| Authorization observation | At `2026-09-13T15:41:37.396Z`, owner `/admin/github/auth/status` returned `authorized` |
| Reported access-token expiry | `2026-09-13T23:41:03.327Z` / `1789342863327` epoch milliseconds |
| Refresh credential metadata | Present: `true`; expires `2027-03-13T15:41:03.327Z`; value not displayed |

The owner status response exposes state and expiry rather than credential values. The published
Connector implementation remains `98ad82b246805cdcdf27712c4ffbf05e8f25f44d`, tag
`v0.1.0-alpha.1`. The earlier production Chrome receipt test used the prior process identity;
its successful result and the earlier unconfirmed project receipt remain unchanged historical
records in [production-browser.md](production-browser.md).

## Independent protected-store and authenticated read verification

At `2026-09-13T15:42:36.808Z`, the read verification completed with these observations:

1. A fresh Node process called the existing `CredentialStore.getGithub()` against the Connector's
   own macOS Keychain item. No credential value was printed or copied into the record.
2. `GET https://api.github.com/user` with that exact stored credential returned HTTP 200 and
   login `imjszhang`. The request observer checked that every observed request stayed on
   `api.github.com` and used the matching Bearer credential. Only boolean assertions were logged,
   not headers or tokens.
3. The existing `GithubClient` resolved the exact public source below, listed its root and
   previewed its selected README. All ten observed identity/repository/commit/tree/blob requests
   returned HTTP 200 with authenticated-request assertions passing; there was no anonymous
   fallback.
4. The existing live core's owner `/admin/github/resolve` and preview independently returned
   matching repository, commit, path, content SHA-256 and size.

| Field | Verified value |
| --- | --- |
| Repository | `https://github.com/imjszhang/aipoch-network` |
| GitHub repository / source ID | `1367114547` / `source:github:1367114547` |
| Explicit full commit | `bf4b365f1fff865e60bd76a6d0de20ccf5ec64db` |
| Selected path | `README.md` |
| Root listing | 23 entries; `README.md` present |
| Preview byte count | `8068` |
| Git blob SHA | `7ffa2f50b8f6509f0fb65efabeea169f4583b037` |
| Content SHA-256 | `70e98039f65f99c6bd7d713c94d73f49c003e7eb793738c8559b2e85e0154fec` |
| Current repository license observation | MIT, observed `2026-09-13T15:42:23.665Z` |

The current repository license observation is not an assertion about the license of the
historical fixed-commit README bytes. No repository file was written or executed by these read
checks.

## Reuse the registered App

After installing the reviewed Connector package and opening Open-Science, ordinary users can
reuse [AIPOCH Connector](https://github.com/apps/aipoch-connector); they do not need to register
their own App:

```sh
aipoch-connector setup --github-client-id Iv23liAWWYs4LOqm1YAg
aipoch-connector github auth start
aipoch-connector github auth status
```

The user completes GitHub's final authorization personally. The public Client ID is explicit
local configuration, not a newly embedded package default. The same option still accepts another
registered GitHub App with Device Flow enabled and suitable read permissions. GitHub authorization
remains optional for public browsing and anonymous source reads.

## Scope of acceptance

The observations verify one real registered App, user consent, macOS protected credential
storage/readback, authenticated identity and public-source reads through both the client and
live core. They do not certify private-repository access, a GitHub App installation, private-key
or client-secret authentication, or real refresh rotation/expiry/revocation. Those lifecycle
paths retain their existing synthetic test coverage; no live rotation or revocation was forced.
Other operating-system credential backends and general host-installer support remain outside
this verified scope. Existing alpha assets, source/schema, package, tag and CI are unchanged.
