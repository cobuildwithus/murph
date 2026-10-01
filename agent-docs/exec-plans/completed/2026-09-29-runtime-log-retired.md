# Ignore authenticated runtime telemetry after ownership retirement

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Outcome and invariant

Late diagnostic uploads should not become route failures after an invocation loses ownership. Keep callback signature, nonce, and owner validation unchanged; stale uploads must not persist data, signal recovery, or schedule alerts.

## Evidence and decision

The invocation finalizer bounds telemetry draining to two seconds and permits remaining writes to finish in the background. The log route currently sends the resulting stale-owner admission rejection to the generic route error handler. A synthetic route regression will prove the narrow correction: acknowledge only the typed 409 stale-owner rejection with the existing zero-count response. All other failures keep their existing behavior.

## Scope and compatibility

Only the Web log route and its proof/documentation change. No new state, dependency, schema, runtime protocol field, or Cloudflare deployment is needed. Active-owner ingestion and accepted-attempt recovery remain unchanged. Internal diagnostics only; no member-facing changelog is needed.

## Tasks

1. Prove stale telemetry is a no-op, while invalid or replayed authentication remains rejected.
2. Implement the route-local response and document its existing response semantics.
3. Run focused routes/auth tests, Web typecheck, complexity review, and inspect the complete diff.
4. Commit the scoped fix. Deployment and external PR gates remain separate from local proof.

## Verification

- The synthetic stale-telemetry regression failed before the change with 409 instead of the expected zero-count acknowledgement.
- `pnpm --dir apps/web test:prepared test/hosted-runtime-internal-routes.test.ts test/hosted-execution/internal.test.ts`: 156 tests passed. After adding the persistence-failure boundary proof, the route suite passed all 143 tests; the unchanged auth suite contributes 14, for 157 focused tests total.
- `pnpm --dir apps/web typecheck` initially found an unprepared importer declaration in the fresh checkout. After `pnpm --dir packages/importers build`, `pnpm --dir apps/web typecheck:prepared` passed. The reproducible preparation gap is recorded in the task-owned Frog entry.
- `pnpm complexity:diff`: passed; changed production function maximum complexity is 8, with no hotspots above 20. The route-local catch is the smallest correction and introduces no new abstraction.
- Parent review and `git diff --check`: passed. Only the typed admission 409 is acknowledged; signatures, nonce consumption, operational fences, ingestion, recovery, alert scheduling, and persistence failures retain their existing boundaries.
- No production deployment or runtime mutation was performed. External review and exact-head CI remain prerequisites for a subsequent PR/production rollout; live confirmation requires observing a naturally late upload after deployment.
Completed: 2026-09-29
