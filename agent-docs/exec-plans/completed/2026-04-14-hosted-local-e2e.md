## Goal

Make local hosted verification truthful by ensuring `pnpm dev` uses a fresh Cloudflare runner bundle, remove greenfield legacy commit-compat handling/tests, and add end-to-end proof for hosted-local activation plus follow-up execution.

## Why

- Hosted-local currently runs a stale `.deploy/runner-bundle`, so worker and container code can drift.
- The current local smoke path is not a trustworthy proof of the recent Cloudflare runner fix.
- Greenfield hosted execution no longer needs ownerless legacy commit compatibility.

## Scope

- `scripts/dev-hosted-local/**`
- `README.md` / Cloudflare docs as needed for truthful local-dev behavior
- `apps/cloudflare/src/**` and `apps/cloudflare/test/**` for greenfield cleanup
- targeted hosted-local E2E coverage

## Verification target

- targeted `apps/cloudflare` tests and typecheck
- hosted-local direct scenario using `pnpm dev`
- new E2E suite covering activation then follow-up run against the live local hosted stack

## Outcome

- `pnpm dev` now launches Cloudflare through an app-owned prepared entrypoint and waits long enough for cold bundle/container startup.
- The live hosted-local activation plus follow-up manual run completed successfully against the real root dev entrypoint.
- `apps/cloudflare test:e2e:local` now proves that end-to-end flow automatically.
- The runner/container path no longer fails warm-container cleanup on legitimate sibling processes and no longer clears the active run lease while a committed result is still finalizing.
Status: completed
Updated: 2026-04-14
Completed: 2026-04-14
