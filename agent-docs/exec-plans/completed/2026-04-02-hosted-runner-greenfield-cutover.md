# Hosted Runner Greenfield Cutover

## Goal

Port the supplied greenfield hosted-runner cutover patch into the current tree so hosted side-effect journaling, assistant delivery reconciliation, runner conflict handling, and container cleanup all match the new fail-closed semantics.

## Why

- The supplied patch intentionally hard-cuts the old hosted side-effect journal layout and sent-only record shape for greenfield deployments.
- The live tree has drifted enough that the patch no longer applies cleanly, so the behavioral intent needs a manual merge.
- This lane touches hosted idempotency, retry, and trust-boundary code where silent fallback behavior is unacceptable.

## Scope

- Cloudflare hosted runner journal, outbound delivery, bundle sync, queue-store, and invoke cleanup paths.
- Shared hosted side-effect contracts and web control-plane behavior.
- Assistant outbox and hosted-runtime callback reconciliation needed to avoid blind resends after partial failures.

## Constraints

- Keep the patch greenfield-only: no compatibility shims for the old side-effect journal layout or sent-only record shape.
- Preserve unrelated dirty-tree edits in adjacent hosted/runtime files.
- Do not widen into broader hosted cleanup outside the supplied patch intent unless required to merge against current code.

## Verification

- `git diff --check`
- `pnpm exec tsc -p packages/hosted-execution/tsconfig.json --pretty false --noEmit`
- Focused typecheck/tests for touched hosted runner paths as far as the current snapshot allows.
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Audit

- Required `task-finish-review` audit pass before handoff when the environment supports spawned audit agents.

## Status

- Completed and ready to close.
- The supplied patch did not apply cleanly with `git apply --check`, so the cutover was merged manually against the live tree.
- Greenfield-only semantics were preserved: no compatibility shims for the old journal key layout or sent-only record shape were kept.

## Outcome

- Hosted side-effect journaling now stores one authoritative record per `effectId` with explicit `prepared` and `sent` states plus prepared-only deletion.
- Hosted assistant delivery now reserves before send, clears definite pre-send failures, stores a provisional local receipt after successful sends, and repairs `prepared -> sent` from that receipt on retry instead of blindly resending.
- Runner side-effect conflicts now fail with `409`, and failed runner invokes destroy the container best-effort before rethrowing.

## Verification Results

- `git diff --check` passed.
- `pnpm exec tsc -p packages/hosted-execution/tsconfig.json --pretty false --noEmit` passed.
- `pnpm exec tsc -p packages/assistant-runtime/tsconfig.json --pretty false --noEmit` passed.
- `pnpm typecheck` passed.
- `pnpm --dir apps/cloudflare verify` passed.
- `pnpm test` failed in a pre-existing unrelated inboxd lane: `packages/inboxd/test/idempotency-rebuild.test.ts` still hits `Error: no such column: mutation_cursor`.
- `pnpm test:coverage` failed for unrelated baseline issues outside this patch: the same inboxd failure plus an `apps/web` smoke lock/env lane problem during that aggregate command.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
