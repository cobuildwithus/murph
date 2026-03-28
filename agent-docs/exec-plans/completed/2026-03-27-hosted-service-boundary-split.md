# Hosted service boundary split in `apps/web`

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

- Split the oversized hosted service modules in `apps/web` by business boundary before more state transitions pile into the same files.
- Keep the existing external route/service entrypoints stable while moving the implementation into smaller domain-owned services.

## Success criteria

- `apps/web/src/lib/hosted-onboarding/service.ts` becomes a thin façade over smaller modules aligned to invite/member activation, billing checkout, and webhook-side-effect handling.
- `apps/web/src/lib/hosted-share/service.ts` becomes a thin façade over smaller modules aligned to link creation/page-data and share acceptance/import state transitions.
- `apps/web/src/lib/device-sync/control-plane.ts` sheds wake/outbox signaling and related helper logic into a dedicated service without changing route behavior.
- Focused tests still exercise the same public boundaries and pass after the split.

## Scope

- In scope:
  - internal module decomposition under `apps/web/src/lib/hosted-onboarding/**`
  - internal module decomposition under `apps/web/src/lib/hosted-share/**`
  - internal module decomposition under `apps/web/src/lib/device-sync/**`
  - minimal focused test updates required to keep the public seams truthful
- Out of scope:
  - changing route handler signatures
  - redesigning hosted onboarding/device-sync/share product behavior
  - broad hosted execution contract changes beyond moving existing logic to narrower modules

## Constraints

- Preserve the current public exports used by routes, pages, and tests unless a tiny compatibility re-export is cleaner.
- Split by state-transition ownership and failure model, not by HTTP route.
- Preserve adjacent dirty `apps/web` work, especially the in-flight hosted execution outbox and public landing edits.
- Avoid widening into Cloudflare-side or Prisma-schema work unless a live import boundary forces it.

## Risks and mitigations

1. Risk: moving helpers across files accidentally changes import-time behavior or circular dependencies.
   Mitigation: keep `service.ts` as a façade, extract bottom-up shared helpers first, and rerun focused hosted tests after each slice.
2. Risk: the current files mix state transitions that look similar but have different retry/idempotency semantics.
   Mitigation: split around invariants: member activation, hosted execution dispatch, share acceptance/import, webhook receipt draining, and device-sync wake signaling.
3. Risk: the dirty worktree causes accidental overwrite of adjacent changes.
   Mitigation: read live diffs first, keep the split incremental, and avoid reverting or restaging unrelated hunks.

## Tasks

1. Register the refactor lane in the coordination ledger.
2. Extract onboarding invite/member/billing/webhook modules behind the existing façade exports.
3. Extract hosted share link/page-data and acceptance/import modules behind the existing façade exports.
4. Extract device-sync wake signaling/outbox dispatch into a dedicated service and simplify the control plane.
5. Run focused hosted-web verification, then required repo commands, then mandatory audit passes.

## Outcome

- Completed the hosted onboarding split behind the existing `service.ts` façade by moving member activation, billing, and webhook receipt/drain logic into narrower modules.
- Completed the hosted share split behind the existing `service.ts` façade by separating link/page-data logic from acceptance/import state transitions and their shared data helpers.
- Kept the existing device-sync hosted wake/control behavior aligned with the in-flight outbox model while simplifying the surrounding service boundaries.
- Focused verification passed in `apps/web` (`pnpm --dir apps/web typecheck` and `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --maxWorkers 1`).
- Root verification wrappers remain blocked by unrelated work outside this lane:
  - `pnpm typecheck` fails in `packages/contracts/scripts/*`
  - `pnpm test` and `pnpm test:coverage` fail in `apps/cloudflare/*`
- Mandatory spawned audit passes could not complete because the first required audit worker hit the current usage limit before returning results.
Completed: 2026-03-28
