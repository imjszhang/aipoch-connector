# Public catalog consumer

`CatalogClient` consumes `https://aipoch.network/catalog/v1/manifest.json` by default.
It does not import the website's search index, a neighboring repository, user credentials,
or the Open-Science SDK. An explicit alternate publication can be supplied; HTTPS is required
except for explicit loopback HTTP development URLs.

## Public API

- `new CatalogClient({ manifestUrl?, fetch?, limits? })`
- `load()` returns one frozen `{ manifest, collections, loadedAt, get(id) }` snapshot.
- `search(query, { limit?, kind? })` searches listed display objects. Limit defaults to 20 and
  cannot exceed 100. Kinds: project, resource, source_repository, actor, organization, collection.
- `get(id)` loads a fresh full snapshot and returns an exact record or undefined. Tombstones
  remain minimal tombstones, not resurrected old source records.

Every call loads and validates one complete snapshot. There is no persistent catalog cache in
v0.1; failed refreshes never fall back silently to stale data. An owner may reuse one `load()`
result within a single display/review operation. The final submission path must recheck the
current object/version/status rather than treating the display snapshot as permanent authority.

## Verification boundary

Each manifest and shard must be valid UTF-8 JSON. Checks include contract version, strict UTC
dates, safe publication-relative paths, no redirects, exact raw byte count and SHA-256, matching
snapshot/version/collection, optional count when present, duplicate identities and paths, plus
full cross-record identity, provenance, permissions, claims, licenses and tombstone semantics.
All custom formats and semantic checks are retained from the published MIT Network contract.
See [vendored origin](../vendor/network-contract/ORIGIN.md).

Unknown optional fields are retained. New syntactically valid resource types remain descriptive
only. Unknown status/permission/runtime enum values are rejected. Verified claim expiry is also
checked against the snapshot publication timestamp. Passing validation proves record consistency,
not maintenance rights, scientific validity, host compatibility or safe execution.

Bounds default to 1 MiB manifest, 8 MiB per shard, 64 MiB aggregate, 4096 shards, 100,000 records,
and a 15-second deadline covering each response body. Shards are fetched sequentially, from URLs
inside the same publication root. The manifest is read once, so concurrent site publication
cannot mix newer descriptors into the operation. Invalid data rejects the entire result.

`CatalogError` has a stable `code` and bounded explanation. No provider response bodies or user
credentials are included. Supported limits are positive integers configured by the local owner.

## Evidence

`tests/catalog.test.ts` covers safe/unsafe paths, UTF-8, bytes and digests, mixed snapshots,
counts, budgets, stalled bodies, private records, tombstone privacy, cross-record provenance,
license/authority semantics and extension compatibility. Synthetic fixtures contain no real
research claims. On 2026-09-13 a real anonymous read validated snapshot
`a9fe477dc576ca357c5524cd` with 20 sources, 19 actors, 18 organizations, 20 projects,
21 resources, 2 collections, 1 relation and no claims/tombstones. This is an observation of that
snapshot, not a durable freshness claim.
