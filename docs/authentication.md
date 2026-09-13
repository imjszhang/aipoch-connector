# GitHub authentication

AIPOCH Network remains publicly browsable without a GitHub account. GitHub authorization belongs
to the local Connector and is required only for the particular GitHub operation that needs it.
The website never receives GitHub access tokens, refresh tokens, daemon credentials or a general
credential-management API.

## Protected storage

`CredentialStore(dataDir)` stores this Connector's GitHub authorization in macOS Keychain using
the system `/usr/bin/security` utility. The Keychain service is fixed to
`network.aipoch.connector.github`; its account is the SHA-256 of the normalized absolute Connector
data directory. Different data directories select different items. Moving the directory changes
the identity and requires explicit reauthorization or a future reviewed migration. Symlink aliases
are not automatically merged.

The item contains a versioned JSON object encoded as base64. Base64 only provides a restricted
character alphabet for the command parser; **Keychain supplies the protection**. The encoded value
is sent to a single `security -i` command over standard input, followed by EOF. Neither the raw
token nor the encoded value is included in process arguments. No shell is involved, standard
streams are captured privately, and subprocess output/errors are never forwarded to a terminal,
browser or log. A successful write is read back and verified before success is reported.

Read and deletion commands contain only the fixed service and hashed account. The implementation
does not enumerate unrelated Keychain items, access Open-Science's credential records, unlock
the Keychain, change its password, or enable access for all applications. Normal macOS Keychain
authorization may still be required. A denied or unavailable store produces an explicit error;
there is no silent plaintext fallback.

On platforms other than macOS, protected storage currently returns
`credential_store_unsupported`. An explicitly supplied environment token may be handled by the
runtime without persistence. The store does not search environment variables or other applications'
configuration for credentials. Do not advertise protected Windows/Linux storage until those
backends and their actual platform behavior are implemented and verified.

## Runtime interface

| Method | Result |
|---|---|
| `getGithub()` | The validated token record if its access token is not expired; otherwise `undefined`. No automatic refresh or GitHub request occurs. |
| `getGithubForRefresh()` | Explicitly reads a validated record even when its access token is expired. Only refresh/reconciliation code may use this entry point. It does not establish that either token is usable. |
| `setGithub(token)` | Validates, stores and verifies the complete authorization record. Invalid fields and unbounded values are rejected before a system call. |
| `deleteGithub()` | Deletes only this data directory's Connector item. Repeating a deletion is safe. |

The runtime must compare `refreshTokenExpiresAt` before refreshing, bind refresh requests to the
configured GitHub application, and persist a successful rotated result before using it. An expired
access token must not be recovered through `getGithubForRefresh()` and sent as ordinary bearer
authorization. A missing expiry is treated as non-expiring locally, but GitHub can still revoke
or reject that credential. Handle authentication failures explicitly rather than changing scopes
or selecting an unrelated credential.

## Device authorization and disconnect

The device flow needs a configured, registered GitHub application client ID and device flow
support. The shared runtime defaults to the registered AIPOCH Connector public Client ID
`Iv23liAWWYs4LOqm1YAg`; an explicit local Client ID overrides it. No authorization starts
automatically. The
local Connector owns polling, timeout/cancellation, token storage and any future refresh. A
device challenge and resulting credentials must not be written to the public catalog or included
in request receipts.

On local logout, cancel pending authorization/refresh work, stop using in-memory credentials and
delete the Connector's Keychain item. Deleting a local item does not revoke an authorization at
GitHub; remote revocation is a separate user action. Disconnecting the Network browser session
also does not imply GitHub authorization has been revoked.

## Verification scope

`node --import tsx --test tests/credentials.test.ts` uses an injected system-command runner. Tests
cover command/stdin separation, directory isolation, expiry, absent/denied stores, deletion,
format validation, parser injection, write verification and bounded errors. They do not write to
or read the user's real Keychain. The installed system utility's help and interactive EOF behavior
were inspected without accessing credential items. Real Keychain round-trip evidence must use
an explicitly authorized test item and must be recorded separately; fixtures do not establish it.
