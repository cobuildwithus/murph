# Final Prod Hardening Follow-Up Patch

## Goal

Land the supplied final hosted hardening follow-up patch against the current repo snapshot without disturbing unrelated dirty-tree edits.

## Scope

- Destroy any leftover native runner container instance before starting a new invocation.
- Remove the stale `HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER` deploy and env surface while keeping a short built-in idle fallback in the one-shot runner path.
- Use timing-safe token comparisons for the container entrypoint bearer token, the Cloudflare runner outbound proxy token, and the hosted web internal bearer-token checks.
- Add or adjust focused regression coverage only where it materially protects those behaviors.

## Constraints

- Treat this as a high-risk hosted trust-boundary and runtime-entrypoint patch landing.
- Preserve unrelated dirty-tree edits already present in the repo.
- Port the supplied patch intent onto the current tree rather than forcing snapshot-era hunks.
- Keep scope narrow; do not reopen broader hosted architecture cleanup.

## Verification

- Focused hosted auth and runner tests for the touched Cloudflare/web paths.
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- In progress
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
