# Cloudflare Test Surface Split

Status: completed
Created: 2026-06-03
Updated: 2026-06-03

## Goal

- Remove hosted-local test routes and test-only Durable Object/container methods
  from the production Cloudflare worker composition and production runner object
  model while preserving hosted-local E2E coverage.

## Success criteria

- Production `workerInternalRoutes` contains only production internal routes and
  no `/__test` paths.
- Hosted-local/E2E worker composition can still opt into the existing
  `/__test` routes through a test entrypoint.
- Production `UserRunnerDurableObject`, `HostedUserRunner`, runner contracts,
  and container interfaces do not expose `ForTest` RPC helpers.
- Deploy smoke write-fence behavior remains a real production diagnostic path.
- Tests mechanically guard that production route lists and production worker
  source stay free of hosted-local test route toggles.

## Scope

- In scope:
- `apps/cloudflare` worker route composition, hosted-local test entrypoint,
  production/test Durable Object split, focused tests, and route docs if needed.
- Out of scope:
- Broad hosted runtime lifecycle changes, provider credential policy changes,
  runner container identity helper work, or web/Temporal protocol changes.

## Constraints

- Preserve existing hosted runtime invariants: one active write fence, foreground
  priority, write-fence authorization, and fail-closed behavior.
- Do not overwrite unrelated dirty changes already present in hosted runtime
  files.
- Keep the architecture simple: production exports production primitives; tests
  add test-only composition at the edge.

## Risks and mitigations

1. Risk: Hosted-local E2E loses its manual drive hooks.
   Mitigation: keep test route modules behind a separate worker/test Durable
   Object entrypoint and point hosted-local harness tests at that entrypoint.
2. Risk: Production deploy smoke accidentally loses write-fence proof.
   Mitigation: leave smoke helpers as production diagnostics without `ForTest`
   names and cover with existing route tests.

## Tasks

1. Split production and hosted-local test route lists.
2. Add a composable worker fetch handler and test worker entrypoint.
3. Move test-only Durable Object RPC onto a test subclass/entrypoint.
4. Narrow production interfaces and adjust route tests/harness imports.
5. Add guard tests for no production `/__test` route/toggle drift.
6. Run scoped verification, required audit passes, and commit with
   `scripts/finish-task` if overlapping dirty work allows a safe scoped commit.

## Decisions

- Treat deploy smoke write-fence methods as product diagnostics, not hosted-local
  test controls. Rename them away from `ForSmoke` if needed instead of deleting
  deploy smoke coverage.

## Verification

- Commands to run:
  - Focused Cloudflare route/worker tests for production and hosted-local route
    composition.
  - `pnpm test:diff` for the touched Cloudflare files when the diff is stable.
- Expected outcomes:
  - Focused tests and diff-aware verification pass, or unrelated blockers are
    reported with concrete failing targets.
Completed: 2026-06-03
