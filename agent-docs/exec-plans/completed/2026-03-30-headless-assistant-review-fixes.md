# Integrate the supplied headless assistant review fixes

Status: completed
Created: 2026-03-30
Updated: 2026-03-30

## Goal

Land the supplied review patch so `murph/assistant-core` exposes deterministic local-only assistant/session/status helpers, `assistantd` hardens its automation/error boundary behavior, and the final hosted/daemon boundary tests reflect the direct `murph/assistant-core` import shape.

## Success criteria

- The supplied patch intent is integrated on top of the live tree without reverting adjacent in-flight edits.
- `murph/assistant-core` exports local-only assistant helpers for the headless boundary instead of ambient daemon-fallback variants.
- Local automation and cron orchestration use the local-only helpers so behavior stays deterministic even when assistantd client env vars are present.
- `assistantd` returns generic 500 errors, validates `/automation/run-once` `deliveryDispatchMode`, and keeps direct regression coverage.
- Hosted and assistant-runtime boundary tests prove the final direct `murph/assistant-core` import shape.
- Verification for this turn is run and recorded, with simplify/task-finish-review intentionally skipped per explicit user instruction.

## Scope

- In scope:
  - `apps/cloudflare/test/node-runner.test.ts`
  - `packages/assistant-runtime/test/assistant-core-boundary.test.ts`
  - `packages/assistantd/src/http.ts`
  - `packages/assistantd/test/{assistant-core-boundary,http}.test.ts`
  - `packages/cli/src/{assistant-core.ts,assistant/{automation/run-loop,cron,outbox,service,status,store}.ts}`
  - this execution plan and the coordination ledger row for the lane
- Out of scope:
  - broader assistant naming cleanup beyond the supplied patch
  - unrelated assistantd/client/runtime refactors already active elsewhere

## Constraints

- Technical constraints:
  - Preserve overlapping assistant-core boundary and assistantd follow-up edits already in flight.
  - Keep the headless boundary deterministic without changing the regular CLI entrypoint behavior.
- Product/process constraints:
  - Skip spawned `simplify` and `task-finish-review` audits for this turn per explicit user instruction.
  - Still run verification and commit via the repo helper if the change lands.

## Risks and mitigations

1. Risk: The supplied patch overlaps files already modified in the live tree.
   Mitigation: Patch surgically against current file contents and avoid reverting unrelated edits.
2. Risk: Local-only helper aliases could accidentally change normal CLI daemon-routing behavior.
   Mitigation: Add only explicit `*Local` variants and keep current exported CLI-facing functions intact.

## Tasks

1. Register the coordination-ledger row for this patch lane.
2. Apply the supplied headless-boundary and assistantd fixes onto the live tree.
3. Add or adapt focused tests for the local-only boundary and assistantd request/error handling.
4. Run verification for this turn, inspect the diff, then close the plan and commit.

## Decisions

- Treat the supplied patch and notes as the source of intent, but adapt the implementation details to the live tree instead of forcing a blind apply.
- Keep the `createIntegratedInboxCliServices` and related naming shape intact for this pass; only land the deterministic local-boundary fix now.
- Skip the repo-mandated spawned completion audits for this turn because the user explicitly requested that override.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Prefer green repo checks; if any fail, record the exact failure and whether it is plausibly unrelated before deciding whether commit is still justified.
- Actual outcomes:
  - `pnpm --dir packages/assistantd test` passed.
  - `pnpm exec vitest run packages/assistant-runtime/test/assistant-core-boundary.test.ts --no-coverage --maxWorkers 1` passed.
  - `pnpm exec vitest run packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-cron.test.ts packages/cli/test/assistant-observability.test.ts --no-coverage --maxWorkers 1` failed in `packages/cli/test/assistant-observability.test.ts` on doctor/quarantine expectations that do not overlap this patch's code paths; the local-status body stayed behaviorally equivalent aside from the new local-only export alias.
  - `pnpm typecheck` failed in unrelated hosted-web code at `apps/web/src/lib/hosted-execution/hydration.ts:267` with `TS2532: Object is possibly 'undefined'.`
  - `pnpm test` failed for the same unrelated hosted-web typecheck at `apps/web/src/lib/hosted-execution/hydration.ts:267`.
  - `pnpm test:coverage` failed for the same unrelated hosted-web typecheck at `apps/web/src/lib/hosted-execution/hydration.ts:267`.
Completed: 2026-03-30
