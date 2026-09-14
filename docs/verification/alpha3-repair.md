# Alpha.3 repair acceptance — 2026-09-14

## Findings and changes

GitHub issues [#1](https://github.com/imjszhang/aipoch-connector/issues/1) and
[#2](https://github.com/imjszhang/aipoch-connector/issues/2) were both confirmed on alpha.2 source.
Before implementation, the new MCP handshake test failed with alpha.1 versus alpha.2;
the complete CLI/runtime acquisition test failed on its second identical command with
`operation_conflict`. The latter was not a first-write failure.

Product version now comes from one validated package manifest reader. Acquisition identity
`acquire-v1` canonicalizes object key order, preserves array order and normalizes the destination
using the runtime's absolute path resolution. It includes the operation kind, complete resolved
source and expected file SHA-256, excluding only `resolvedAt` and repository license
`observedAt`. All other source fields, licenses and conditions participate; changed metadata
can therefore require a new explicit review rather than being silently ignored. Operation ID
is the journal key, not a substitute for input comparison.

New records atomically retain the original complete input and identity format alongside the
pending journal entry before file writes. Completed replay returns the original stored result
without a second blob fetch or file write. The CLI still resolves the repository on each call,
so GitHub availability/identity validation is still required; recovery queries themselves do not
require a GitHub read. Pending/unknown results are not retried. A saved success is historical
operation evidence, not a claim that the destination has never subsequently been changed.

Schema 1 migration adds an evidence table under schema 2 and leaves existing tables/rows intact.
Legacy input hashes/results stay unchanged. A legacy request with the exact original full digest
retains its original replay behavior; otherwise `legacy_operation_unverifiable` explicitly directs
owner reconciliation. Old records do not contain sufficient information to infer stable identities.
Alpha.1/alpha.2 reject schema 2; use an intact pre-upgrade backup for a deliberate rollback.

## Local evidence

- Node 24.18.1, macOS arm64; isolated temporary Connector directories, no running host required.
- Before-change regressions: both issues failed at their reported boundary.
- `npm run check`: 108/108 tests, typecheck and build passed after the core changes.
- `tests/acquisition-identity.test.ts`: timestamp/key ordering/path normalization, changed commit,
  path, repository, ref, digest, destination, license and conditions; original source preservation;
  real schema-1 fixture upgrade with receipt/association/complete/pending retention and reopening;
  newer-schema rejection without deleting evidence.
- `tests/helpers/acquisition-acceptance.mjs`: actual CLI processes and shared core; same command
  replay, restart, unchanged bytes/inode/mtime, no repeated blob fetch with the synthetic transport,
  conflicting destination, new operation against an existing destination, pending operation after
  restart with no repeated file retrieval. Real stdio MCP checks product versions, 20 tools and
  `connection_status`. An injected opener captures the pending MCP review without operating its
  confirmation page; no destination or durable operation is created.
- `tests/package-smoke.mjs`: independently installs the packed tarball, checks SDK provenance,
  and runs the same CLI/stdio/preparation acceptance using that installation. Only temporary
  Connector runtimes are started and stopped; no Open-Science host is started.

## Real anonymous GitHub candidate check

The independently installed candidate passed the same acquisition/replay/restart/no-overwrite
and unknown-result checks using GitHub's actual API and the issue's exact public source:

| Field | Value |
| --- | --- |
| Repository | `https://github.com/imjszhang/aipoch-network` |
| Full commit | `72419cdf51d56edd9d182b812218ef5aad7af2aa` |
| File | `LICENSE` |
| SHA-256 | `bc9e74b6cd56bfbf4507473c5d417feb93c083b83f81f6cce59ed853f6f26657` |
| Bytes | 1084 |
| Package version | `0.1.0-alpha.3` |

The environment token was removed for these temporary processes, their Connector directory had
no configured credentials, and the test used no personal host profile. Synthetic transport
request counting and actual GitHub success are separate evidence. No packet capture was made
for the live API. This is not real desktop-host/browser acceptance, private-repository access
or OAuth refresh/revocation evidence.

## Publication gate

At preparation of this record, publication and downloaded-release acceptance are pending.
The release must pass hosted checks, expose a tarball/checksum, and its downloaded original
asset must pass `node tests/package-smoke.mjs /absolute/downloaded.tgz --live` before issues
are closed. The invocation installs that original supplied asset; fixture tests remain default
and the live check is explicitly opt-in.
