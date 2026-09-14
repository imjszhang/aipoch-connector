# v0.1 implementation plan

Authorized 2026-09-13. Implement the full loop: Network choice → authenticated local connection
→ durable reference receipt → explicit association and use in Open-Science. Public repository:
imjszhang/aipoch-connector. Independent Node/TypeScript local runtime, MIT original code.

## Phases and evidence

| Phase | Deliverable | Exit evidence | Status |
|---|---|---|---|
| P0 | SDK distribution, host readiness, browser transport and lifecycle feasibility | Exact versions; real host and HTTPS browser connection | Complete for the tested scope: pinned SDK, rebuilt development host, installed Connector and actual production Chrome/macOS pairing/receipt verified; additional browser/host-installer support is not inferred |
| P1 | Public repository, package, CI, architecture and agent instructions | Independent install/build/test and public remote | Complete: public source commit `98ad82b246805cdcdf27712c4ffbf05e8f25f44d`, hosted CI/release 101/101, independently verified published alpha tarball and real installed-package setup/discovery |
| P2 | Validated catalog, GitHub identity/version reading, optional read authorization | Real public sources and adversarial fixtures | Complete for the tested scope: anonymous source/adversarial checks and full-review receipt passed; the user registered and authorized AIPOCH Connector, then real macOS Keychain readback, authenticated identity/public-source reads and live-core resolve/preview passed; no private-repository or live refresh/revocation claim |
| P3 | Durable inbox, project mappings, MCP, diagnostics | Host tool discovery and restart recovery | Complete for the tested local scope: independently installed package setup, public discovery of 20 tools, actual stdio queries, host/Connector lifecycle and preserved durable records verified |
| P4 | Browser pairing/session/reference transport | Exact confirmed contents durably received | Complete for the tested transport scope: local receipts, two-source durable HTTP integration and deployed Chrome resource receipt passed; visible receipt/history matched the independently recomputed stored digest; the earlier unconfirmed project request remains a separate historical result |
| P5 | Existing/new project association and explicitly selected file acquisition | Actual host project IDs and verified files | Complete for the tested local scope: captured synthetic actions verified existing association, exact created host project ID and acquired destination SHA; mappings, operation records and file bytes remained after restart/package removal |
| P6 | Network real adapter, bounded pairing wait, release modes | Design behavior, independent CI, real-mode candidate | Complete for the tested scope: recovery implementation `bf4b365f1fff865e60bd76a6d0de20ccf5ec64db` passed 283 unit checks and root/subpath real browser fixtures each 12/12, fresh candidate and Pages verify/deploy/smoke; actual deployed Chrome pairing, matched resource receipt, same-session Disconnect/public state and durable retention passed |
| P7 | Recovery, packaging, upgrades, release and deployment | Supported browser/host matrix; release and Pages evidence | Complete for the tested release scope: published Connector alpha 101-test checks, independent install/discovery/removal with retained data, host/runtime lifecycle, Network recovery deployment and production Chrome receipt/disconnect/retention passed; P2 real-App acceptance is separately recorded, and broader compatibility is not advertised |

This table distinguishes implemented code from actual acceptance. The exact evidence, scope and
next steps are recorded in [verification/progress.md](verification/progress.md). Do not mark a
phase complete from its fixture coverage, a workflow definition or another phase's result.

## Non-negotiable acceptance

Anonymous browsing remains available. Installed/enabled does not prove connected. Received does
not prove import/execution. Pairing approval binds origin/host/scopes; submission binds exact
review content and action. No GitHub auth UI on Network. No full daemon token in browser.
Durable request deduplication survives restart; uncertain host writes require reconciliation.
Multi-source references and full commits/paths/licenses/conditions survive end-to-end.
Direct GitHub URLs work without prior catalog membership. Revoked/stale objects cannot silently
retain confirmation. Explicit file retrieval never runs repository hooks or overwrites files.
Website Saved/Recent stay browser-local. No fabricated personal projects, contributions or follows.

## Deliverables

README, AGENTS, product boundaries, architecture decisions, protocol, connection/auth guidance,
Open-Science adapter/compatibility documentation, v9-r2 integration mapping, operations
(diagnostics/upgrade/uninstall/recovery), test evidence and release record. Default checks need
no live host or credentials; opt-in real integration checks remain separate. Platform support
only follows actual verification. Source references are not runtime workspace dependencies.

## Release sequence

Installable Connector candidate → real host/browser joint check → Network real build → Pages
deployment verification. Roll back Network to unavailable if necessary; preserve local data.
No npm name/SDK availability or OAuth registration is assumed before verification.

## Local action confirmation

MCP `create_project`, `associate_reference` and `acquire_github_file` prepare an exact captured
plan through the owner-only administrative channel, then open a single-use local confirmation
page. The human confirms/declines; agents must not approve by browser automation or direct local
commands. `get_action_result` distinguishes pending/running/complete/declined/failed. Preparing a
plan or opening a page performs no write. The action view expires after ten minutes and is not
the durable operation journal; a missing/failed view requires reconciliation, not automatic retry.
Explicit owner CLI operations remain direct. Browser sessions receive no administrative action
capability, private target plan or confirmation ticket.

## Later roadmap, not v0.1 requirements

v0.2: full repository acquisition/update checks and generic native host reference management.
v0.3: contribution drafts, GitHub PRs and progress. v1.0: stable protocol and verified platform
support, mature recovery. Cross-device synchronization/public accounts require separate design.

## Alpha.3 repair checkpoint — 2026-09-14

The alpha.2 MCP version and acquisition replay defects in issues #1/#2 supersede any interpretation that all recovery paths passed historical acceptance. Alpha.3 supplies a common version source, stable acquisition identities and explicit legacy-record handling. Historical host/browser results above remain scoped to their original observations. See [repair acceptance](verification/alpha3-repair.md) for current tests, migration limitations and publication status.

Alpha.3 is now published from `df14bef2cfcde3bcf45b7a98fe924d0d22762c74`. Release workflow `34809866810` passed 108/108 checks and independent package acceptance; the downloaded asset checksum and real anonymous GitHub recovery/stdio checks also passed. This closes the two new-release defects, while legacy-record reconciliation and the historical compatibility limits remain explicit.
