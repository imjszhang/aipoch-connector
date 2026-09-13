# v0.1 implementation plan

Authorized 2026-09-13. Implement the full loop: Network choice → authenticated local connection
→ durable reference receipt → explicit association and use in Open-Science. Public repository:
imjszhang/aipoch-connector. Independent Node/TypeScript local runtime, MIT original code.

## Phases and evidence

| Phase | Deliverable | Exit evidence | Status |
|---|---|---|---|
| P0 | SDK distribution, host readiness, browser transport and lifecycle feasibility | Exact versions; real host and HTTPS browser connection | Partial: pinned SDK, rebuilt real development host and local in-app-browser pairing/receipt verified; production HTTPS/browser support pending |
| P1 | Public repository, package, CI, architecture and agent instructions | Independent install/build/test and public remote | Partial: public remote, final local checks, independent smoke and real installed-package setup/discovery passed; initial Connector commit/push and hosted CI/release evidence pending |
| P2 | Validated catalog, GitHub identity/version reading, optional read authorization | Real public sources and adversarial fixtures | Partial: anonymous real catalog/GitHub reads, hostile-input fixtures and full current-review resource receipt passed; device/Keychain/refresh implemented, registered GitHub App client ID and real user authorization pending |
| P3 | Durable inbox, project mappings, MCP, diagnostics | Host tool discovery and restart recovery | Complete for the tested local scope: independently installed package setup, public discovery of 20 tools, actual stdio queries, host/Connector lifecycle and preserved durable records verified |
| P4 | Browser pairing/session/reference transport | Exact confirmed contents durably received | Partial: local browser receipts for AnnData and an additional resource passed, including the current full review guard; root/subpath browser fixtures each 6/6; production HTTPS and additional browser support pending |
| P5 | Existing/new project association and explicitly selected file acquisition | Actual host project IDs and verified files | Complete for the tested local scope: captured synthetic actions verified existing association, exact created host project ID and acquired destination SHA; mappings, operation records and file bytes remained after restart/package removal |
| P6 | Network real adapter, bounded pairing wait, release modes | Design behavior, independent CI, real-mode candidate | Partial: 255 checks and root/subpath browser fixtures each 6/6 passed; adapter source pushed to Network main at `e3eb65895b1bebe64f3cefcf18996213bf525313`; local real flow and hosted fresh candidate verified; Network CI in progress, Pages activation/HTTPS verification pending |
| P7 | Recovery, packaging, upgrades, release and deployment | Supported browser/host matrix; release and Pages evidence | Partial: final Connector 100 checks plus five targeted checks/build, independent smoke, actual installed-package setup/discovery and clean uninstall with retained data passed; broader support matrix, Connector hosted release and Pages deployment pending |

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
