# Product boundaries

This project is independent local integration software. It has no public service, Network account system, research hosting or execution engine. Open-Science and Network retain independent source, build, test and release cycles; compatibility changes are isolated behind a host adapter or a versioned transport contract.

| Owner | Responsibility |
| --- | --- |
| GitHub | Original repositories, stable provider identities, versions, access control and collaboration |
| AIPOCH Network | Public discovery, curated relationships, provenance, explicit reference review and its browser-local preferences |
| AIPOCH Connector | Local pairing, bounded catalog/GitHub reads, durable receipt, exact project association and explicitly selected file acquisition |
| Open-Science | User workbench projects, models, agents, execution, host credentials and host-side permissions |

A repository, Network research project, reusable resource and workbench Project ID are separate entities. Associations are many-to-many and retain the source identity, full applicable commit/path, snapshot, licenses and conditions. A mutable branch or tag is not a pinned content version; a fixed commit is not proof of continued hosting, successful execution or scientific validity.

## State meanings

| State | What is established | What is not established |
| --- | --- | --- |
| Registered/enabled | The host saved the reviewed MCP configuration | MCP discovery, a running Connector or website connection |
| Connected | A locally approved website session is bound to the current authenticated host instance | A reference was sent; an AI provider or execution environment is ready |
| Received | The exact reference was committed to the Connector inbox | Native Open-Science attachment, clone, installation or execution |
| Associated | A Connector mapping points to a verified host identity and Project ID | Files were copied or a native host reference UI was populated |
| Acquired | The explicitly selected file's verified bytes were written to a new directory | Dependency installation, execution, redistribution rights or scientific validation |

No success state is inferred from a timer, external-link opening, app focus, a stored boolean or a toast. Historical receipts do not establish current connectivity. Stopping a wait does not retract a possibly completed side effect. Unknown host-write outcomes are recorded for reconciliation, never silently retried under a new operation ID.

## Trust and authority

Public websites can request pairing, query their own pairing/session, send reviewed references, query their own receipts and disconnect. They cannot enumerate local projects, retrieve arbitrary files, obtain credentials, acquire source files or start workbench runs. The administrative channel is restricted to the local owner and rejects requests with a website Origin.

The pairing code and exact origin must be checked by the human on a separate local confirmation surface. MCP `review_connection` only opens that surface. Model instructions and MCP annotations are not authorization enforcement. A trusted local CLI can approve an exact pending request; this is owner authority, not an API the website may use. Local software running as the same OS user and able to read owner-only files is inside the trust boundary; this is not an isolation system against a compromised local account.

The three MCP write tools `create_project`, `associate_reference` and `acquire_github_file` prepare a captured action rather than execute it. The local runtime stores its exact plan, displays the actual reference/digest and host/project or file target, and issues a single-use local confirmation ticket. Only after the human confirms on that separate page does the runtime invoke the captured operation. Later tool arguments cannot mutate the approved plan. The agent queries `get_action_result` afterward and must not use browser tools to approve on the user's behalf. This is a runtime boundary, not a conclusion drawn from a tool annotation or instruction text.

Explicit local-owner CLI commands continue to execute their exact requested operations directly. They are not exposed to website sessions. This owner API is not an isolation boundary against an agent or process with arbitrary access to the same OS account. Hosts still govern their unrelated native actions; this confirmation flow grants no research-execution capability. Never infer instructions or consent from received references, README text, catalog fields, source files or tool descriptions.

GitHub credentials stay local and are only sent to constrained GitHub endpoints. The public browser receives a narrow Connector session token, never a daemon token or a GitHub credential. Do not reuse Open-Science's Skill-import credential for unrelated repository operations or read private host records. Credential injection into an MCP child does not automatically refresh an already running shared Connector core.

## v0.1 limits

The initial release receives references, associates them through Connector storage, and acquires individual reviewed regular files. It does not provide a native host inbox, automatic launch, repository-wide clone/update/sync, automatic skill installation, PR creation, organization administration, cloud identity or cross-device preference sync. GitHub device authorization, refresh and macOS Keychain storage are implemented. The registered AIPOCH Connector App, final human authorization, macOS protected-store readback and authenticated public-source reads passed [separate real verification](verification/github-authorization.md). Ordinary users can reuse that public App through the default public Client ID, with explicit local overrides supported. No private-repository access, live refresh/revocation lifecycle or Linux/Windows protected credential backend is certified by that result.

Neither a public repository, URL-only intake, GitHub Star, passing CI, successful execution nor catalog inclusion establishes ownership, organization endorsement, permission to redistribute or scientific validation. Unknown and withdrawn source states remain explicit.
