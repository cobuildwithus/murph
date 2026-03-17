# `@healthybob/web`

Local-only Next.js read surface for the Healthy Bob vault.

## Purpose

- read the vault on the server through `@healthybob/query`
- render a small operator-facing observability UI
- stay read-only for canonical vault data and avoid inventing a second storage system
- optionally start device OAuth/account actions through a separate local `@healthybob/device-syncd` control plane
- keep search scoped to safe record fields instead of path-derived metadata

## Local usage

Run the app from this package with an explicit vault root:

```bash
HEALTHYBOB_VAULT=../../fixtures/demo-web-vault pnpm dev
```

The package launch wrappers bind Next to `127.0.0.1` and block framework `.env*` reads. If `HEALTHYBOB_VAULT` is unset, the app shows a setup screen instead of guessing paths.
The local launcher keeps `@healthybob/query` on its normal package export and will ensure the built runtime closure for `@healthybob/contracts`, `@healthybob/runtime-state`, and `@healthybob/query` exists before Next starts.
The wrapper also preserves the original `pnpm` launch cwd so package-local relative vault paths like `../../fixtures/demo-web-vault` keep resolving from `packages/web`.
The Next webpack config also pins `@healthybob/query` to that built `dist/index.js` entry so repo-wide workspace source aliases do not leak `packages/query/src` into the local app.

If `HEALTHYBOB_DEVICE_SYNC_BASE_URL` points at a running local device-sync daemon, the home page also renders a wearable section with one-click connect, reconcile, and disconnect actions. Those actions call the separate device control plane and do not bypass the vault/query read boundary.
