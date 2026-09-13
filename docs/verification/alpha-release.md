# Published alpha release verification — 2026-09-13

This records the actual GitHub release and downloaded artifact for `0.1.0-alpha.1`.
It was written after publication and is not included in the already published tagged tarball.
No local host/runtime was started, stopped or changed during this verification; the downloaded
package was inspected without installation or execution.

## Source, tag and release

| Evidence | Verified value |
| --- | --- |
| Source commit | [`98ad82b246805cdcdf27712c4ffbf05e8f25f44d`](https://github.com/imjszhang/aipoch-connector/commit/98ad82b246805cdcdf27712c4ffbf05e8f25f44d) |
| Tag | [`v0.1.0-alpha.1`](https://github.com/imjszhang/aipoch-connector/tree/v0.1.0-alpha.1) |
| Remote annotated tag object | `bc7d47cfd3eb8451f59cea9cff64e89ea22dc884`; its GitHub API target is the exact source commit above |
| Release | [AIPOCH Connector v0.1.0-alpha.1](https://github.com/imjszhang/aipoch-connector/releases/tag/v0.1.0-alpha.1) |
| Release state | Published; `isPrerelease: true`, `isDraft: false` |
| Publication time | `2026-09-13T12:49:08Z` |

The tag reference and annotated tag object were read from GitHub, rather than inferred from
the release's `targetCommitish: main` field. Both successful workflow runs below report the
same exact source commit. This establishes the observed tag target; it does not claim a signed tag.

## Hosted checks

| Run | Actual result |
| --- | --- |
| [Initial main CI — 34758039439](https://github.com/imjszhang/aipoch-connector/actions/runs/34758039439) | Success; typecheck, **101 tests / 101 passed / 0 failed**, build and independent package-install smoke passed |
| [Tag release — 34758105055](https://github.com/imjszhang/aipoch-connector/actions/runs/34758105055) | Success; exact tag/package version check, typecheck, **101 tests / 101 passed / 0 failed**, build, independent package-install smoke, artifact retention and GitHub Release publication passed |

The hosted jobs used the Ubuntu 24.04 runner and Node `24.18.1`. The test counts and package
smoke success were checked in each run's actual logs. The smoke test installs the packed package
in an independent directory, checks CLI help, imports the public SDK/local inbox and validates
vendored SDK integrity; it explicitly does not start a runtime or host.

## Downloaded artifact

The published [tarball](https://github.com/imjszhang/aipoch-connector/releases/download/v0.1.0-alpha.1/aipoch-connector-0.1.0-alpha.1.tgz)
and [SHA256SUMS](https://github.com/imjszhang/aipoch-connector/releases/download/v0.1.0-alpha.1/SHA256SUMS)
were downloaded into a new temporary directory, separately from the repository's build output.
The SHA-256 calculated from the downloaded bytes matched both `SHA256SUMS` and GitHub's asset
digest metadata.

| Item | Verified value |
| --- | --- |
| Tarball filename | `aipoch-connector-0.1.0-alpha.1.tgz` |
| Tarball size | `202645` bytes |
| Tarball SHA-256 | `aea6f82962b0dd3858af5d164044fb7cafb2a93824a200b761e5fc0b1a2019a5` |
| SHA256SUMS size | `101` bytes |
| SHA256SUMS SHA-256 | `e2699836bac797e883dd03abfca35c0e0c1d3a5ea14f62d0cb6469c94eca0463` |
| Package metadata | `aipoch-connector`, version `0.1.0-alpha.1`, license `MIT`, Node `>=24.18.1 <25` |
| Archive entries | `92` regular files; no links or special entries |

Archive inspection confirmed the CLI, runtime, MCP, inbox, host adapter, required documentation,
original license, third-party notices and vendored SDK license/provenance are present. Entry
paths remain under `package/` without traversal. No runtime discovery/lock files, inbox database,
`.env` files, credential JSON/key files, `node_modules`, `.git` or `.local` directories appeared
in the archive listing. This is a concrete inventory check, not a general claim that arbitrary
content can never contain sensitive text.

All **11** vendored upstream distribution files matched their SHA-256 values in the packaged
`vendor/open-science/ORIGIN.json`. The NodeNext declaration alias `index.d.mts` matched
`index.d.ts` byte for byte.

## Scope of this evidence

This closes verification of the actual published GitHub alpha artifact and hosted checks.
It does not establish production HTTPS/Pages behavior, packaged Open-Science compatibility,
live GitHub authorization, or additional operating-system/browser support. Those require their
own recorded checks. The release workflow publishes GitHub assets; it does not publish an npm
registry package or deploy AIPOCH Network.
