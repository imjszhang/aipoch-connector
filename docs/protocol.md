# Local browser protocol 1.0

The browser API is an independently versioned local transport. It consumes the existing Network review payload without changing the public `catalog/v1` domain contract. This document describes the current implementation, not browser/host compatibility certification.

## Endpoint and authority

Default origin: `http://127.0.0.1:47821`. The server listens on the loopback address and validates its exact Host header. Public `/v1/` requests must carry an explicitly allowed Origin: `https://aipoch.network` by default; an exact loopback development origin can be configured locally. Redirected/token-bearing arbitrary origins are not discovery endpoints. CORS preflight allows GET, POST, DELETE and Authorization/Content-Type; CORS is not authentication.

Pairing lasts 180,000 ms. Approved sessions last 1,800,000 ms and bind the exact origin and authenticated host instance. All timestamps are Unix milliseconds. Pairing/session credentials exist only in runtime memory and expire on restart; inbox receipts remain on disk. A missing or changed host invalidates affected sessions. The host's authenticated readiness says nothing about an AI provider or research runtime being configured.

## Pairing and sessions

| Request | Authentication | Response |
| --- | --- | --- |
| `POST /v1/pairings` | Allowed Origin; JSON `{protocolVersion:'1.0', attemptId}` | `{pairingId, expiresAt, verificationCode, pollToken}` |
| `GET /v1/pairings/:pairingId` | Same Origin; Bearer pollToken | `{status:'pending'}` or `{status:'denied'}` or approved session below |
| `GET /v1/session` | Same Origin; Bearer session token | `{id, expiresAt, hostReady:true}` after current host authentication |
| `DELETE /v1/session` | Same Origin; Bearer session token | `{disconnected:true}`; invalidates this session if present |

An approved poll returns `{status:'approved', session:{id,token,expiresAt,protocolVersion:'1.0'}}`. `attemptId` is a nonempty identifier of at most 200 ASCII word/dot/hyphen characters. Pairing IDs are UUIDs. The poll token grants access only to the corresponding pairing, not administrative operations or reference submission. At most 20 unexpired pairing records are retained; a busy runtime may return `too_many_pairings`.

Approval happens on a trusted local surface. `review_connection` requests a short-lived, private confirmation ticket through the owner-authenticated administrative API and opens `/local/confirm?ticket=…`. The human checks origin and code and submits the decision. The ticket is not a daemon/session token, must not be shared in chat/logs, and becomes unusable when expired, consumed, or its pairing is no longer pending. No website endpoint approves pairing. The local CLI's explicit approve command requires the exact pending pairing ID, code and origin.

The Network adapter checks `/v1/session` after approval, then periodically verifies the current session. It keeps credentials only in private memory and re-verifies after refresh/new tabs. Cancelling browser waiting does not create a remote cancellation claim; unused pairing requests expire.

## Receive an exact reference

`POST /v1/references` requires the same Origin, session Bearer token and JSON body:

```json
{
  "protocolVersion": "1.0",
  "requestId": "reference-unique-id",
  "sessionId": "approved-session-id",
  "objectId": "project:example",
  "action": "receive_reference",
  "review": {
    "format": "aipoch-network-internal-review-1",
    "content": "the exact complete reviewed JSON text",
    "sha256": "64 lowercase hexadecimal characters"
  }
}
```

This illustration uses placeholders and is not a valid research payload. IDs are 1–200 characters from letters, digits, colon, dot, underscore and hyphen. Unknown envelope or review-wrapper properties are rejected. The supported action only receives a reference; it grants no import or execution authority.

`review.content` is the **exact original string the user reviewed**. `review.sha256` is SHA-256 of that string's UTF-8 bytes, with no trimming, Unicode normalization, parsing/reserialization, key sorting or newline conversion. JSON encoding of the outer request may escape this string; the receiver hashes the decoded string, not the complete HTTP body. The content is limited to 256 KiB UTF-8; the entire encoded HTTP body is limited to 260 KiB. Escaping can make a permitted content string too large for the outer body, so clients must check both limits.

`aipoch-network-internal-review-1` remains a **supported opaque review payload format**, not a new public research-domain schema. The current receiver parses only the required compatibility/safety fields: matching format/object ID, project/resource kind and title, target Open-Science, matching Open/Use action, snapshot ID, source list and conditions. Applicable source commits must be complete lowercase 40-character SHA values; content hashes are complete lowercase SHA-256. It preserves all reviewed bytes and does not treat source material as instructions or executable configuration.

For new requests, the runtime also checks the current validated public catalog: the object must remain available, the snapshot must match, and referenced sources cannot be withdrawn/private/deleted. A changed snapshot requires refresh and new review; it is not silently substituted. This guard confirms current identities and availability, not that every claimed license/condition is a scientific or legal certification. Exact replay of an already received request returns its original durable receipt rather than rewriting it from a newer catalog.

After durable inbox storage, the response is:

```json
{
  "protocolVersion": "1.0",
  "requestId": "reference-unique-id",
  "sessionId": "approved-session-id",
  "objectId": "project:example",
  "contentSha256": "the exact reviewed-content digest",
  "outcome": "received",
  "receivedAt": 1900000000000
}
```

The browser must match protocol, request, session, object and content digest, then check that its current active session and reviewed content still match. Only `received` is defined by this receiver. Receipt means Connector inbox storage, not native workbench attachment, installation, execution or validation.

`GET /v1/receipts/:requestId` returns the receipt only when it belongs to the active session. A replay with the same request ID but different session, object, content or host instance is a `request_conflict`; the earlier record is preserved. Runtime restart removes browser sessions but not receipts. Historical results can then be inspected through trusted local CLI/MCP, not by reusing an expired website session. New sessions must not reuse an old request ID to claim a new send.

## Failures and local-only actions

Errors have `{error:{code,message}}` and an appropriate HTTP status. Relevant codes include `origin_denied`, `invalid_host`, `unsupported_protocol`, `pairing_expired`, `pairing_mismatch`, `host_unavailable`, `host_changed`, `unauthorized`, `invalid_reference`, `content_mismatch`, `catalog_changed`, `source_unavailable`, `request_conflict`, `receipt_missing` and `body_too_large`. Messages are bounded product diagnostics, not provider response bodies or credentials. Clients must not infer non-delivery from network failure, timeout or a stopped wait, and must never automatically retry a side effect with a fresh ID.

`/admin/` is not a browser integration API. It requires the owner token from protected local discovery and rejects an Origin header. CLI/MCP use it for status, pairing review, inbox inspection, exact project selection/association and approved GitHub acquisition. Project creation writes a durable pending operation record before the host request; uncertain outcomes require listing/reconciliation. A different payload under the same operation ID conflicts. Completed replays return their recorded result.

## Captured local actions

`POST /admin/actions` receives `{kind,input}` for exactly `create_project`, `associate_reference` or `acquire_github_file`. This endpoint requires owner authentication and rejects website Origins. The runtime clones the input, validates the relevant target and prepares a display plus execution closure. Association review includes the exact inbox request/digest, actual project and host identity. File review includes the resolved source, verified SHA-256, size, normalized new destination and operation ID. Creation preserves the explicit name, description, host and operation ID. Changed targets/content require a newly prepared plan; later MCP input cannot rewrite the captured one.

Preparation returns `{actionId,status:'waiting_for_user',url,expiresAt}`. The private URL carries a separate single-use ticket for `/local/confirm`; the MCP tool opens it locally but returns only action ID, status and expiry to the model. Do not include the URL/ticket, owner token, private project list or full local plans in Network responses. The action ID is not an authorization credential. Preparation and GET of the review page perform no write, although read-only target/file validation may happen during preparation.

Only a human's explicit POST decision on the local page consumes the ticket and executes or declines the captured action. The Network Origin cannot approve it. MCP exposes no tool to approve these actions, and agents must not substitute browser automation or direct local-owner calls for the human decision. A reused ticket cannot perform the action twice. Explicit owner CLI commands remain separate direct operations, with the same content/target/host checks and durable operation rules.

`GET /admin/actions/:actionId` is owner-only and returns `{actionId,status,result?}`; MCP exposes it as `get_action_result`. Current stages are:

| Stage | Meaning |
| --- | --- |
| `waiting_for_user` | Preparation response only; a local page was requested, no write was performed |
| `pending` | Result query while awaiting the human's decision |
| `running` | Approved captured operation has started; completion is not established |
| `complete` | The operation returned a result; inspect its type—creation, mapping or acquired file—not research execution |
| `declined` | The local human declined; this action did not execute |
| `failed` | The operation did not return a confirmed successful result; a partial or already completed side effect may require reconciliation |

Action review/result records and tickets are in runtime memory, expire after ten minutes, and are limited to 30 unexpired action records. Restart loses this view; `action_expired` does not imply a previous write never happened. Inbox records, associations and creation/acquisition operation journals are durable and must be inspected before any replacement attempt. Local result expiry, a missing result, browser closure or stopped waiting never licenses automatic retry or a new operation ID.

Transport changes require explicit version handling and independent Network adapter tests. An HTTP fixture does not establish that a browser permits HTTPS-to-loopback access; production support needs real browser, local permission and host lifecycle evidence.


## Runtime configuration and durable recovery

Owner-only `GET /admin/runtime` reports `identityVersion: 1`, a unique `runtimeId`, PID,
a SHA-256 data-directory identity, `configSha256`, `packageVersion`, `codeSha256`, and
`nodeVersion`. It contains no administrative, session, daemon or GitHub token. This is local
runtime diagnostics, not a Network domain schema or browser capability. Setup compares the
exact owner-protected discovery record with the live authenticated identity before requesting
`POST /admin/shutdown` for a configuration/version change, and confirms a new matching
instance. Unknown/legacy identity is a conflict requiring explicit local-owner reconciliation;
it is not permission to terminate an arbitrary PID. The data directory serializes concurrent
startup/reconfiguration. Configuration/code digest matching excludes environment credentials:
changing an environment credential still requires an explicit owner restart.

Owner-only `GET /admin/operations` returns recent durable creation/acquisition operations;
`GET /admin/operations/:operationId` returns one, or `operation_missing` (404). IDs contain
1–100 ASCII word/dot/hyphen characters. The record includes `operationId`, `inputHash`,
`state: pending | complete`, `outcome: unknown | complete`, `retryAllowed: false` and a saved
`result` only when complete. The digest binds captured input but is not the content digest of
an arbitrary source file. These read-only queries survive runtime restart and never create or
retry operations. Prepared creation/acquisition results also return the captured `operationId` so it can be retained before approval and used when the temporary action view expires. An unapproved plan does not create that durable record. MCP exposes `list_operations` / `get_operation`; CLI exposes
`operations list` / `operations show OPERATION_ID`. They remain local-owner surfaces, and
Network sessions cannot inspect all operation or local project records. Results may contain
local research paths/context and are not automatically shareable diagnostics.

A missing action view after its ten-minute lifetime is distinct from a missing durable operation.
An unapproved action need not have a durable side-effect record. A pending durable operation
requires checking the exact host project or destination before further action. CLI acquisition
requires `--operation-id`; repeating an identical completed operation can return its saved
result, while uncertain writes are never repeated automatically.

## Alpha.3 acquisition identity and storage compatibility

Browser protocol remains 1.0 and MCP protocol negotiation is unchanged. MCP product version and runtime product version now use the installed package manifest. Owner-only operation queries add optional `identityVersion` and `input` for new acquisition records. These fields include complete reviewed source metadata and local paths; they are not public diagnostics.

`acquire-v1` hashes a canonical JSON object containing `version: 1`, `kind: acquire_github_file`, the resolved `source`, `expectedSha256`, and an absolute normalized `destination`. Only `source.resolvedAt` and `source.repositoryLicenseObservation.observedAt` are removed for hashing. All other fields, including licenses/conditions and ref, remain binding; object keys are sorted recursively and array order is preserved. Full original input is retained unchanged separately. Completed replay returns the stored result; pending replay returns `result_unconfirmed`; changed identity returns `operation_conflict`.

Schema 2 adds `operation_evidence` atomically without rewriting old records. Missing legacy evidence allows only an exact original full-input hash match; otherwise `legacy_operation_unverifiable` (409) requires owner reconciliation. Older binaries reject the new database version. No reverse migration or guessed legacy identity is provided. Existing destination errors retain their `destination_exists` code through the owner CLI.
