# Default loopback HTTP — real browser transport evidence

Observed at **2026-09-14T09:13:54.422Z**. The optional `tests/browser-loopback.mjs`
passed using installed Google Chrome **152.0.7977.84**, headless, in a fresh isolated
browser profile, driven by Playwright **1.63.0**. Connector source package version
was **0.1.0-alpha.4**; Node **24.18.1**; macOS **26.6.2 / 25G83**;
Darwin **25.6.0 arm64**.

The test used `configuration()` on a new private temporary directory, observed
`origins: ["https://aipoch.network"]` and `allowLoopbackHttp: true`, and passed those
values to the real bridge. The core used only an in-memory inbox and a synthetic host.
Every server listened on a loopback address and a randomly allocated port. All temporary
servers, browser profiles and configuration were removed at completion.

## Browser-generated origins and observed HTTP traffic

| Actual webpage origin | Browser OPTIONS | Browser pairing POST | Pairing poll | Missing session credential |
| --- | --- | --- | --- | --- |
| `http://localhost:56346` | 204 | 200 | pending | 401 unauthorized |
| `http://localhost:56354` | 204 | 200 | pending | 401 unauthorized |
| `http://127.0.0.1:56359` | 204 | 200 | pending | 401 unauthorized |
| `http://[::1]:56364` | 204 | 200 | pending | 401 unauthorized |

The test executed native `fetch()` from each real page; it did not supply an Origin
header, intercept requests, alter DNS or disable browser origin isolation. Server-side
request/response observations verified that both preflight and actual responses echoed
the exact origin with `Vary: Origin`. A browser command-line check rejects web-security,
site-isolation or DNS-bypass arguments. The explicit `--enable-automation` argument only
allows that command-line check.

Additional results:

- The first localhost pairing poll token was rejected with 401 from the other localhost
  port, the IPv4 hostname and the IPv6 hostname.
- Browser access to `/admin/status` was rejected: a simple POST reached the actual handler
  with Origin and received 401 without CORS; an Authorization-bearing GET's preflight
  also received 401 without CORS. Both browser reads failed under ordinary CORS handling.
- With `allowLoopbackHttp: false`, all four origins received 403 on preflight and actual
  simple GET; failed preflight prevented the pairing POST. No CORS allowance was emitted.
- With policy false and just the first exact localhost origin added explicitly, that origin
  paired successfully while the second localhost port remained blocked.
- All five created pairing records remained pending; no session was approved and the inbox
  stayed empty. The host fixture rejects any project listing or creation attempt.

## Reproduction

With Node dependencies installed and an independently installed Playwright module:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs BROWSER_CHANNEL=chrome node --import tsx tests/browser-loopback.mjs
```

Omit `BROWSER_CHANNEL=chrome` to use Playwright's own installed Chromium. No Playwright
dependency or browser is added to the Connector package. This optional acceptance fixture
is distinct from default unit/contract tests.

## Evidence boundary

This establishes real Chrome HTTP/CORS and pending-pairing transport from the tested
loopback origins, including an actual IPv6 page. It does **not** establish a fresh full
Network real-mode UI → user comparison/approval → real Open-Science host → delivered
durable receipt flow. No real host was launched, no real product confirmation was opened
or approved, and no browser permission prompt was bypassed. It does not establish new
production HTTPS, Firefox, other OS, real-host restart or official installer support.
Those results must remain separately scoped in the implementation acceptance document.
