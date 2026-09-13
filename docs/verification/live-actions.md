# Real local action verification — 2026-09-13

These checks used the rebuilt Open-Science `0.28.0` development host, an isolated test profile,
the working-tree Connector build `0.1.0-alpha.1`, and Codex's in-app browser. The operator used
UI automation to approve **synthetic implementation-test actions only**, involving public
reference data and a temporary destination. This is not a record of real research-user consent,
GitHub authorization, packaged-host certification, or production HTTPS verification.

## Captured plan and confirmation

Preparing a plan and opening its page produced no mutation. The original native POST form did
not navigate in the in-app browser. Confirmation now progressively enhances the native form
with a nonce-authorized, same-origin request and renders the returned result as text. Native
forms remain available without JavaScript. The page still rejects foreign origins, cannot be
framed, and grants no browser access to the owner API.

After the fix, the real browser displayed `Action completed` for each of the actions below.
The owner API and actual host/files were checked independently of that display.

| Action | Exact verification |
| --- | --- |
| Associate received AnnData | Request `reference-0421de3e-a411-4b51-9891-430f9561f503`, reviewed SHA-256 `b9784cd3d9813c049410a34600247f471d33219a41a2f675bdad3ce0e2404eb5`, linked to host project `cmtzr77u600008oviwkff5nh0` (`AIPOCH Connector integration probe`); querying project associations returned that request |
| Create a project | Operation `connector-live-project-20260913` returned actual host project `cmtzslk3f00008oa5667gpavb` (`AIPOCH Connector approved creation probe`); subsequent authenticated project listing returned the same ID and name |
| Acquire one public file | Repository `imjszhang/aipoch-network`, stable GitHub ID `1367114547`, commit `9858c6925df6fc041c2ad421f3252ccc7fb3c51d`, path `README.md`; preview and independently hashed destination both matched `70e98039f65f99c6bd7d713c94d73f49c003e7eb793738c8559b2e85e0154fec`, 8,068 bytes |

The file went into a new directory under the isolated temporary Connector data directory. No
repository hooks, install step or research execution ran. Current repository MIT metadata was
shown separately from the unknown fixed-file license; it was not silently promoted to a verified
license for those historical file bytes.

## Restart observation and regression checks

The Connector was orderly stopped and started during the confirmation-page repair. The existing
AnnData receipt remained available after restart. The open Network page changed to `Interrupted`,
restored the public hero and hid connected-only personal actions. Reconnection was required;
persisted browser data did not grant a new session.

The real host was then stopped through its public CLI using the exact isolated config root.
Connector status returned `ready: false`, reason `host_not_running`. Restarting that profile
through the public CLI produced PID 23516, version `0.28.0`, and a new process identity. Connector
status returned ready with the same stable host identity; both actual test projects and the
AnnData association remained available. No research profile or source files were changed.
Final independently installed-package recovery is a separate check until recorded.

The slow concurrent confirmation regression sends two partially read HTTP requests for one
ticket. Exactly one executes and returns HTTP 200; the other returns 410. Origin rejection,
single-use replay, no-write preparation and captured-target behavior are also covered. Host
creation tests pin the authenticated client to the approved host and preserve an uncertain
operation when the host changes after a write.

Confirmation URLs, runtime credentials and local approval tickets are intentionally omitted.
