# Hosted Runner Legacy Cleanups

## Goal

Remove the stale runtime-platform liveness input, mark remaining hosted-runner legacy compatibility names with explicit deletion-date comments, and make Cloudflare deploy CI print the exact checked-out commit SHA.

## Constraints

- Keep behavior unchanged except for CI log visibility.
- Preserve deploy-skew compatibility shims until the dated deletion window.
- Do not expose user identifiers, secrets, or local paths.

## Scope

- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-state-store.ts`
- `apps/cloudflare/src/user-runner/runner-state-schema.ts`
- `apps/cloudflare/src/user-runner/runner-state-helpers.ts`
- `apps/cloudflare/src/user-runner/types.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- `apps/cloudflare/src/runner-outbound/write-fence.ts`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `apps/cloudflare/test/runner-platform.test.ts`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- Focused tests only if required by type/test fallout.

## Verification

- Prefer `pnpm test:diff` for the touched files.
- Run `pnpm typecheck`.
- Use scoped Cloudflare verification only if full acceptance is blocked by unrelated active work.

## State

- Registered 2026-05-12.
- Implementation complete; stale liveness input removed, legacy comments tightened, deploy SHA logging added, and focused tests updated.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
