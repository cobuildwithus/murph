# `@murph/local-web`

Local-only Next.js read surface for the Murph vault.

## Purpose

- read the vault on the server through `@murph/query`
- render a small operator-facing observability UI
- lead the home surface with a calm weekly compass: what changed, what stayed steady, what likely explains the week, and what is probably not worth reacting to yet
- stay read-only for canonical vault data and avoid inventing a second storage system
- optionally start device OAuth/account actions through a separate local `@murph/device-syncd` control plane
- keep search scoped to safe record fields instead of path-derived metadata

## Local usage

Run the app from this package with an explicit vault root:

```bash
VAULT=../../fixtures/demo-web-vault pnpm dev
```

The package launch wrapper blocks framework `.env*` reads and otherwise leaves host selection to Next or any explicit CLI flags you pass. If `VAULT` is unset, the app falls back to the saved Murph CLI default vault when one exists. If neither is available, the app shows a setup screen instead of guessing paths.
Within this repo, the app resolves workspace packages from source and lets Next transpile them directly. The local launcher no longer rebuilds workspace `dist/` trees before startup.
The wrapper also preserves the original `pnpm` launch cwd so package-local relative vault paths like `../../fixtures/demo-web-vault` keep resolving from `packages/local-web`.
If `DEVICE_SYNC_BASE_URL` points at a running local device-sync daemon and the server environment also has `DEVICE_SYNC_CONTROL_TOKEN`, the home page also renders a wearable section with one-click connect, reconcile, and disconnect actions. Those actions call the separate authenticated local device control plane and do not bypass the vault/query read boundary. The overview now leads with a compass-style weekly read before the operational device-sync section so the first question is what the week means, not what protocol to add next.

## Local verification

- `pnpm --dir packages/local-web lint` runs the explicit ESLint CLI with `eslint-config-next`.
- `pnpm --dir packages/local-web test` is the fast Vitest loop for the local web package.
- `pnpm --dir packages/local-web verify` adds package-local typecheck, lint, and production build coverage on top of that test loop.
