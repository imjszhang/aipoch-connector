# Production HTTPS browser verification — 2026-09-13

**Status: deployed Chrome pairing, receipt, disconnect and durable-retention retest passed.**
After the Network recovery fix deployed, a newly paired Chrome session sent one separately
reviewed resource and displayed **Reference received**. Its visible receipt/history matched the
durable Connector record and independently recomputed original-content digest. Disconnect then
restored public browsing, and a subsequent owner read verified that the receipt remained intact. The earlier
project submission still has its historical **Delivery is unconfirmed** browser result; it was
not resent or reinterpreted as recovered. Real GitHub App authorization subsequently passed
in a separate check recorded in [github-authorization.md](github-authorization.md).

## Environment and implementation identities

| Field | Observed value |
| --- | --- |
| Website origin | `https://aipoch.network` |
| First observed Network implementation / snapshot | `e3eb65895b1bebe64f3cefcf18996213bf525313` / `26ba825d9cdfbeeabbdb7b98` |
| Successful receipt retest implementation / snapshot | `bf4b365f1fff865e60bd76a6d0de20ccf5ec64db` / `32da27d09e6f0bff68dcf6d4` |
| Browser | Google Chrome `152.0.7977.84`, official build, `arm64`; observed in the native `chrome://version` UI |
| Operating system | macOS `26.6.2`, build `25G83`, `arm64` |
| Local Connector endpoint | `http://127.0.0.1:47821` |
| Connector package / protocol | `0.1.0-alpha.1` / `1.0` |
| Connector process | PID `26431` |
| Connector runtime code SHA-256 | `f4a21a366cbf3e0ac8910a153464cb6241ce572900170c4da912cb48513abc07` |
| Published Connector implementation | `98ad82b246805cdcdf27712c4ffbf05e8f25f44d`, tag `v0.1.0-alpha.1` |
| Authenticated host | Ready; rebuilt Open-Science development host reporting `0.28.0` |
| Host checkout | `9abd170b5269c650a9af7e3e3701ab378d05e153`; tracked worktree clean at the environment check |
| Stable host identity | `f009b6e8385e2b5d154fe733811aafd03c7901e0c01b696a33bea64b63a8fbc8` |
| Host process identity | `b8a3c0d91fca2d8ff65ca6ec9bb64d8b11f201f1f9b86efe986c496b5f2d18ba` |

Chrome's installed application metadata independently reported the same product version. The
browser version/architecture in this table additionally comes from its actual native version
page, not merely that static metadata. The local confirmation page opened in the default browser,
Firefox; no Firefox version or general Firefox website compatibility is certified here.

The user explicitly allowed `aipoch.network` to access apps and services on the local device in
Chrome. No browser permission or security control was bypassed. Pairing and sending below used
public AnnData reference data in the isolated implementation-test environment. These synthetic
verification actions do not authorize an agent to approve a research user's product actions.

## First pairing and product-state observations

1. The first pairing attempt expired after its three-minute window while native UI inspection
   was still in progress. Confirmation was correctly rejected; the expired request did not
   establish a connected session.
2. A new pairing showed matching website origin and short code in the production webpage and
   owner review. Its local review page opened in Firefox and was confirmed before expiry.
   Chrome then displayed **Connected**, retained **AnnData**, and opened the complete reference
   review for that original selection.
3. The connected production homepage displayed **Welcome back** with **Your feed**, **Your
   projects**, **Saved**, **Following**, and **Contributions**. The AnnData selection remained
   available through this flow.
4. Choosing **Disconnect** returned Chrome to **Not connected**, restored the **Science Open to
   All** public hero and hid the personal area. A persisted receipt did not keep the browser
   connected after explicit disconnection.

These are actual HTTPS-page observations against the real local bridge and rebuilt host. They
establish the described Chrome flow, not support for arbitrary browsers, operating systems or
an official distributed Open-Science installer.

## First delivery: durable receipt succeeded, browser confirmation did not

The production page sent the reviewed AnnData reference. Independent inspection of the durable
Connector record established the following values, including a SHA-256 recomputed from the
stored original review text:

| Field | Verified value |
| --- | --- |
| Request ID | `reference-6b3225a4-5929-4a36-8aa1-0be073f203cf` |
| Object ID | `project:anndata` |
| Received at | `2026-09-13T13:36:14.442Z` |
| Original reviewed-content SHA-256 | `8212fb765256cb6f526f2b130421a92dd7e307c23a4b734cdcb3f198053b2de2` |
| Catalog snapshot | `26ba825d9cdfbeeabbdb7b98` |
| Source identity | `source:github:100038377` |
| Full source commit | `4ded337f96f2b3331c9cfaede4e32cbc3078fcc2` |
| Reviewed source license | BSD 3-Clause (`BSD-3-Clause`) |
| Browser result | **Delivery is unconfirmed**; zero successful receipts shown |

The stored request proves durable local receipt. It does not make that browser's unconfirmed
state a successful receipt UI, and it does not prove project import, association or research
execution. The request remained stored and was not resent. The later resource test below is a
separately reviewed new action, not a recovery claim for this project request.

## Cold catalog observation and recovery work

A separate, fresh public `CatalogClient` load began at `2026-09-13T13:40:02.633Z` and took
**32,353 ms**. It read nine shards containing 101 records; all requests returned HTTP 200.
The manifest request took **7,260 ms** and the sources request **8,904 ms**. This was an
independent diagnostic observation after the delivery, not a measurement of the original
submission's precise duration.

The first deployed Network adapter used an eight-second request timeout inside a fifteen-second
engine budget. The observed cold load and serial catalog loading expose a mismatch with those
budgets and support the delivery-recovery diagnosis. They do not alone establish the exact
timing of the original failed browser response.

The deployed Network repair keeps one reference POST, performs bounded receipt GET recovery
using that same request ID, and gives real delivery a sixty-second total budget. Connector
production code, package and the already published alpha tag are unchanged by this work.

## Repair deployment and public artifact verification

| Evidence | Recorded result |
| --- | --- |
| Network repair implementation | `bf4b365f1fff865e60bd76a6d0de20ccf5ec64db` |
| [Complete CI — 34761126783](https://github.com/imjszhang/aipoch-network/actions/runs/34761126783) | Success; 283 unit checks and complete browser matrix, including 12 real protocol checks each for root/subpath |
| [Fresh candidate — 34761136095](https://github.com/imjszhang/aipoch-network/actions/runs/34761136095) | Success; snapshot `32da27d09e6f0bff68dcf6d4` generated `2026-09-13T13:55:02.266Z` |
| [Pages — 34761579849](https://github.com/imjszhang/aipoch-network/actions/runs/34761579849) | Verify, deploy and smoke all succeeded |
| Published entry/metadata/catalog | Public index bytes matched the independently reviewed artifact; build-info mode and manifest/internal-catalog snapshot matched the reviewed real-mode candidate |
| Published JavaScript | `assets/index-DCctdyxM.js`, SHA-256 `ebfcb607fbcfbb788ca0070a0e278c1cd4ca5361c6a6e4fdcd3e578bc3a99cc5`; matched the reviewed artifact |

After deployment, independent Node HTTPS connections to GitHub Pages timed out; bounded
sequential public reads then passed. Chrome's first ordinary reload showed that the full catalog
had not loaded; a hard reload subsequently loaded it successfully. No new reference was sent
during that observation. The successful retest used the verified deployed bytes and current
snapshot recorded above. These transient observations do not identify a specific network/cache
cause or establish a permanent site or Connector failure.

## Deployed Chrome retest: browser and durable receipt matched

A new real pairing was reviewed and approved in the local Firefox confirmation UI. Chrome then
reviewed **AnnData research software**, object `resource:anndata-library`, action **Use**, as a
separate selection from the earlier project. **Send** was clicked exactly once. Chrome displayed
**Reference received**, the research home showed **1 receipt**, and opening receipt history
showed the matching request/session identity. The owner independently read the stored original
review and recomputed its digest, which matched the received record.

| Field | Verified value |
| --- | --- |
| Request ID | `reference-fcbbc1cd-1fe3-4d3a-953c-e6a468c56a23` |
| Session ID (identifier, not credential) | `8ac9efe7-5341-482e-8718-7a20184074df` |
| Object / reviewed action | `resource:anndata-library` / `Use` |
| Received at | `2026-09-13T14:21:24.771Z` / `1789309284771` epoch milliseconds |
| Original reviewed-content SHA-256 | `82594b943b854174e57ccc0fd2cc28f36e7066e4b1cc630c0d8920ba0ecd305c` |
| Catalog snapshot | `32da27d09e6f0bff68dcf6d4` |
| Source identity / URL | `source:github:100038377` / `https://github.com/scverse/anndata` |
| Full source commit | `4ded337f96f2b3331c9cfaede4e32cbc3078fcc2` |
| Source / resource license | `BSD-3-Clause` / `BSD-3-Clause` |
| Source observation / resolution time | `2026-09-13T13:54:56.990Z` |
| Conditions and unspecified source facts | Empty conditions; unknown path, named reference and file SHA preserved |
| Browser result | **Reference received**; research home **1 receipt**; matching receipt-history identity |

The Send-trigger observation was at `14:20:54 UTC`, approximately thirty seconds before the
recorded receipt. This is an observation interval, not precise HTTP request timing. No
packet-level receipt-GET trace was captured, so this record does not assert which individual
recovery GET completed the UI flow. The deployed implementation, bounded recovery tests and
actual matched browser/durable outcome are separate evidence.

The successful new resource request does not recover or supersede the earlier project request.
Both durable records remain distinct.

## Post-success disconnect and durable retention

In the same successful Chrome single-page-app session, the operator opened the header panel and
selected **Disconnect**. The panel changed to **Not connected**, with **Connect Open-Science**
and **Get Open-Science** available. After closing the panel, the actual page accessibility tree
showed the public **Science Open to All** hero, **Join with Open-Science**, search and all five
directory counts, plus public cards offering **Connect to open** or **Connect to use**. Personal
views and Save actions were absent. No reload was needed. The URL still retained
`?personal=feed&activity=receipts`; those query values did not grant access to connected state.

At `2026-09-13T14:37:52.435Z`, an owner read of the exact new receipt after disconnection returned
the same receipt fields. Its stored original review text was independently
hashed again and still matched
`82594b943b854174e57ccc0fd2cc28f36e7066e4b1cc630c0d8920ba0ecd305c`.
This completes the observed chain: pairing → exact review → received UI and identity → explicit
disconnect/public state → durable receipt retention. Disconnect did not delete the local record.

## Related authorization acceptance

The user subsequently registered and authorized the public AIPOCH Connector GitHub App.
Fresh-process macOS Keychain readback, authenticated identity/public-source reads and matching
live-core resolution/preview passed. See [github-authorization.md](github-authorization.md).
That configuration update restarted the local core after this browser test; it does not alter
the process identity, exact requests or results recorded here.

No private confirmation URL, ticket, session token, runtime credential or user-profile path is
included in this record. Existing alpha publication and installed-package lifecycle evidence
remain separate historical records. The Chrome result establishes this exact browser/macOS/
rebuilt-host flow, not additional browser, operating-system or official host-installer support.
