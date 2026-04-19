# Tighten hosted wake boundary and runner web-control surfaces

Status: active
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Close the remaining hosted cutover surface gaps that are outside the in-flight CAS/quarantine plan slice: fail-closed helper scoping, runner web-control allowlisting, fail-closed bundle-ref mutation handling, and dead/stale boundary helpers.

## Success criteria

- Exported hosted-wake lookup helpers require `userId` and no longer default to unscoped event-id lookup.
- `apps/cloudflare/src/runner-outbound/web-control.ts` rejects non-allowlisted proxy paths.
- `apps/cloudflare/src/user-runner/runner-state-store.ts` and related helpers stop treating malformed `bundle_ref_json` as `null` or an implicit repair during mutation/CAS paths.
- Dead runner route/debug helpers are removed from the live contract/code surface.
- `scripts/verify-workspace-boundaries.mjs` no longer references deleted hosted outbox-payload seams or removed runner route helpers.

## Scope

- In scope:
- `apps/cloudflare/src/runner-outbound/{web-control,results}.ts`
- `apps/cloudflare/src/user-runner/{runner-state-store,runner-state-helpers,runner-bundle-sync}.ts`
- `apps/cloudflare/test/{runner-outbound,runner-platform}.test.ts`
- focused bundle-ref regression tests under `apps/cloudflare/test/**`
- `apps/web/src/lib/hosted-wake/{queue,lifecycle,store,store-data,store-append}.ts`
- focused hosted-wake tests under `apps/web/test/**`
- `packages/hosted-execution/src/routes.ts`
- `packages/hosted-execution/test/hosted-execution.test.ts`
- `scripts/verify-workspace-boundaries.mjs`
- Out of scope:
- Reworking the already-active quarantine proof / snapshotRef validation lane in route handlers and Cloudflare wake-commit helpers
- Broad hosted runtime or device-sync architecture changes

## Constraints

- Technical constraints:
- Preserve unrelated in-flight edits already present in the hosted-wake boundary-fixes lane.
- Product/process constraints:
- Keep this scoped to cutover hardening and dead-surface cleanup.
- Respect the active hosted-wake boundary-fixes row as exclusive for the broader wake/cursor lane.

## Risks and mitigations

1. Risk: helper-signature tightening can ripple through many callsites and tests.
   Mitigation: change the exported helper surface first, then update only the direct callsites surfaced by search/typecheck.
2. Risk: allowlisting the web-control proxy could block a legitimate child-callable path.
   Mitigation: derive the allowlist from the current runtime-platform callsites and add explicit positive/negative tests.
3. Risk: bundle-ref mutation hardening could conflict with the separate no-op `RunnerStateStore.ready` cleanup already in flight.
   Mitigation: keep the bundle-ref change limited to corruption parsing/assignment paths and avoid refactoring unrelated store initialization logic.

## Tasks

1. Tighten exported hosted-wake lookup helpers to require `userId` and fail closed on owner mismatch.
2. Add a path allowlist to the runner web-control proxy and cover it with focused tests.
3. Make bundle-ref mutation/CAS paths fail closed when `bundle_ref_json` is malformed, and add focused regression coverage.
4. Delete dead runner route/debug helpers and remove matching stale boundary-script checks.
5. Run scoped verification, required audit passes, and commit with the plan artifact.

## Decisions

- Treat same-seq snapshot publishing as already landed and out of scope for this companion plan.
- Keep any remaining global event-id lookup private-only; the exported helper surface should require `userId`.
- Limit the runner web-control allowlist to the currently used child-callable hosted web paths: internal device-sync snapshot/apply/connect-link and hosted usage recording.
- Treat malformed stored bundle refs as persistent corruption until an explicit valid replacement overwrites them.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff scripts/verify-workspace-boundaries.mjs apps/cloudflare/src/runner-outbound/web-control.ts apps/cloudflare/src/runner-outbound/results.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/src/user-runner/runner-state-helpers.ts apps/cloudflare/src/user-runner/runner-bundle-sync.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-state-store.test.ts apps/web/src/lib/hosted-wake/queue.ts apps/web/src/lib/hosted-wake/lifecycle.ts apps/web/src/lib/hosted-wake/store.ts apps/web/src/lib/hosted-wake/store-data.ts apps/web/src/lib/hosted-wake/store-append.ts apps/web/test/hosted-wake-store.test.ts packages/hosted-execution/src/routes.ts packages/hosted-execution/test/hosted-execution.test.ts`
- Required completion-workflow audits: `coverage-write` on `gpt-5.4-mini`, then `task-finish-review`
- Expected outcomes:
- Helper-level hosted-wake lookups are owner-scoped by default.
- The runner web-control proxy only forwards the narrow hosted callback paths still in use.
- Runner bundle-ref mutation paths fail closed on malformed stored refs instead of silently clearing or repairing them.
- The repo boundary script and hosted-execution route surface no longer mention removed seams.
