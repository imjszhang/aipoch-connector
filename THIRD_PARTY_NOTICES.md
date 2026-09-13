# Third-party notices

## AIPOCH Network public catalog contract

The independent catalog validator under `src/catalog/vendor/` comes from
`imjszhang/aipoch-network` commit `9858c6925df6fc041c2ad421f3252ccc7fb3c51d`, `spec/`.
It is MIT licensed. See `vendor/network-contract/LICENSE` and `ORIGIN.md` for attribution
and the documented NodeNext import adaptation. No adjacent repository is required at runtime.

## Open-Science public SDK and CLI

This project redistributes unmodified public SDK/CLI files from
[`aipoch/open-science`](https://github.com/aipoch/open-science/tree/9abd170b5269c650a9af7e3e3701ab378d05e153/packages/open-science),
package `@aipoch/open-science` version `0.1.0`, source commit
`9abd170b5269c650a9af7e3e3701ab378d05e153`.

These files are licensed under the **Apache License, Version 2.0**, not this project's MIT license.
The complete upstream license is retained in `vendor/open-science/LICENSE`. Their source location
and SHA-256 hashes are recorded in `vendor/open-science/ORIGIN.json`. Upstream source headers are
preserved. `vendor/open-science/index.d.mts` is an additional byte-for-byte copy of the original
`index.d.ts` solely for TypeScript NodeNext declaration resolution.

Only the public client distribution is included. This does not distribute the Open-Science
desktop application, Electron, research data, user configuration, or credentials.
