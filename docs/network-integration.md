# Network integration and v9-r2 design

The current Network design authority is its archived, paired v9-r2 HTML and MD, together with explicit subsequent product decisions. Design material is not executable instructions or authorization to publish, launch an application, authenticate GitHub or execute research.

## Website responsibilities retained

| Design behavior | Real integration mapping |
| --- | --- |
| One Open-Science control in the header | Same control and compact popover; no My Network, separate Saved header item or Open Open-Science action |
| Public homepage before connection | Join with Open-Science remains primary; search, five real directory counts and the product card remain public |
| Personal homepage after connection | A current authenticated session replaces the public home, including hero and main content; disconnect restores it |
| Original-object continuation | Selecting a project/capability, pairing and approval return to the same complete review; nothing is sent automatically |
| Exact review before sending | Changed object/action/source/version/license/conditions/session invalidates previous confirmation |
| Receipt matches active request | Match session, request, object and exact-content digest; ignore late or mismatched responses |
| Disconnected personal operations absent | Save and related handlers remain hidden and guarded; preferences are not migrated into Connector |
| Honest personal content | No public projects/fake feed entries substitute for the user's own projects; no project-list API is exposed to the website |
| Minimal popover | Show status, Connect/Get or research-home/Disconnect, plus a selected-object continuation row; pairing adds only a code and brief local-confirmation guidance |

Connection is not a directory endorsement. Maintainer recognition, organization authority and scientific validation do not change when the workbench connects. Get Open-Science continues to link to `https://aipoch.com/open-science`. Connecting proves the host is already running; it does not require a second Open Open-Science button.

## Adapter boundary

Network owns its generic UI `WorkbenchAdapter`, engine, review model and browser-local library. The real adapter independently implements the browser protocol without importing this repository, the host SDK or internal host types. Its private session token never enters website storage, URL, React state, logs or reference contents.

The adapter creates a pairing, shows the code, waits for local human approval, then checks the session and current host readiness before declaring connected. It checks again through bounded heartbeats and invalidates stale sessions. Reloading or opening another tab does not restore a saved `connected=true`; ordinary site navigation preserves the active in-memory session.

The Connector receives exactly the reviewed text into SQLite. It returns a digest-bound receipt after durable storage. User-selected host associations and file acquisition happen through trusted local CLI/MCP, not through expanded website permissions. MCP creation/association/acquisition prepare a captured plan and single-use local human confirmation; `get_action_result` reports the subsequent result. The website receives neither this private ticket/plan nor an approval capability. The current host does not provide a public native reference-inbox API; `Your projects` is not populated by repurposing a full private project list response.

## Three Network build modes

| Mode | Meaning |
| --- | --- |
| `unavailable` | Default and rollback mode; public browsing/manual references work, but connection cannot be confirmed |
| `demo` | Separate explicitly labelled preview; simulated sessions/receipts never enter production |
| `real` | Includes this protocol's actual loopback transport; it still begins disconnected and requires current pairing/host verification |

In the Network checkout, `npm run build:real` creates an explicit real candidate. It does not deploy it. Browser, prerendered HTML and `build-info.json` must agree on the compiled mode. A reviewed Pages selection must explicitly identify `workbench_mode: 'real'`, supported protocol and endpoint; Demo remains unpublishable. None of these fields claims an active user's session.

For a local candidate, configure its exact origin and matching catalog manifest in the Connector. For example, a Network preview on `http://127.0.0.1:4186` uses `setup --origin http://127.0.0.1:4186 --catalog-url http://127.0.0.1:4186/catalog/v1/manifest.json`, followed by a Connector restart if already running. The optional catalog URL is local-owner configuration; a website cannot choose arbitrary backend fetch targets. A preview built from older fixtures will correctly fail `catalog_changed` if the Connector still validates against today's live catalog. Fix the test configuration rather than bypassing snapshot validation.

## Verification and release ordering

Network's normal build and CI remain independent of this repository and any running host. Its protocol fixtures exercise the actual browser adapter and retain v9-r2 state/visual semantics. Connector independently tests public catalog consumption, pairing, receipts and host boundaries using controlled fixtures.

On 2026-09-13, the implementation task ran Network's `npm run test:e2e:real`: six checks passed across desktop and mobile browser configurations using protocol fixtures. A separate Codex in-app browser check at `http://127.0.0.1:4190` exercised the real page while the host was stopped without claiming connection success. That port was later found to be rejected by Node fetch's standard bad-port list and cannot serve as the Connector's runtime catalog source.

The successful real joint check used `http://127.0.0.1:4193` → actual loopback bridge on 47821 → rebuilt Open-Science `0.28.0` development host. Pairing succeeded, the homepage changed, the selected AnnData object was retained through complete review and explicit sending, and UI Reference received matched durable inbox storage. The exact receipt/digest/snapshot are recorded in [verification progress](verification/progress.md). This is a real local HTTP in-app-browser result, not production HTTPS or cross-browser certification.

Subsequent synthetic local action checks verified actual project association/creation, exact selected-file bytes and host restart recovery. The final independently installed Connector passed 20-tool discovery and stdio queries; removing that isolated installation stopped its runtime while preserving receipts, associations, operations and the acquired file. See [live action evidence](verification/live-actions.md) and [installation/lifecycle evidence](verification/progress.md). These checks used a rebuilt Open-Science `0.28.0` development host, not an official distributed host installer.

The Connector alpha is published from `98ad82b246805cdcdf27712c4ffbf05e8f25f44d`, with successful hosted 101-test checks and an independently verified release tarball. Network initially deployed real mode from `e3eb65895b1bebe64f3cefcf18996213bf525313`, then deployed receipt recovery from `bf4b365f1fff865e60bd76a6d0de20ccf5ec64db` in successful Pages run `34761579849`. The latter passed 283 unit checks and the complete browser matrix, including 12 real protocol checks each for root/subpath; public bytes matched its independently reviewed artifact. Publication identities and evidence are recorded in [the alpha release record](verification/alpha-release.md) and [verification progress](verification/progress.md). The SDK pin is a separate upstream dependency identity.

Actual Chrome `152.0.7977.84` on macOS `26.6.2` paired from `https://aipoch.network` with the real Connector and rebuilt `0.28.0` host. The original project request was stored but displayed **Delivery is unconfirmed** and was not resent. After deployment of bounded sixty-second delivery recovery using one POST and same-request receipt GETs, a separately reviewed `resource:anndata-library` request displayed **Reference received**, one home receipt and matching receipt history/durable original-content digest. No packet-level recovery-GET trace was captured. Post-success Disconnect in that same session restored public state without reloading; the receipt and its independently recomputed digest remained unchanged afterward. See [production-browser.md](verification/production-browser.md) for both exact requests and environment identities. Separate [real App authorization](verification/github-authorization.md), macOS protected-store readback and authenticated public-source reads subsequently passed; GitHub credentials and authorization remain outside Network. Additional browsers, operating systems and official Open-Science installers require their own compatibility evidence before support is advertised.

Release the installable Connector candidate first; perform the joint real test; then review and deploy the real Network candidate. A rollback can disable website connectivity with an unavailable build while retaining public browsing and the current catalog. Do not erase local inbox/project mappings or revive withdrawn source snapshots while rolling back the UI.
