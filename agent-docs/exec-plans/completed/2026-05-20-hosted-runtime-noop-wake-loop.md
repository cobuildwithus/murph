## Goal

Stop hosted runtime no-op wake loops where an already-dirty invocation receives
repeated external runtime wakes, re-runs foreground assistant passes, and
defers the idle-shutdown checkpoint indefinitely.

## Constraints

- Preserve hosted mailbox replay and late active-turn input semantics.
- Do not log raw payloads, prompts, transcripts, user ids, local paths,
  provider bodies, secrets, or other sensitive identifiers.
- Keep the fix scoped to in-invocation liveness/projection state; avoid broad
  runner, container, or web status rewrites.
- Preserve unrelated dirty work and overlapping active hosted runner plans.

## Plan

1. Confirm the live loop from DB and Docker logs.
2. Patch foreground dirty-window replay so consumed wake metadata is carried
   forward in memory before the idle checkpoint commits.
3. Add focused assistant-runtime regression coverage for repeated no-op wakes
   after a due scheduled wake has already been consumed.
4. Run targeted tests/typecheck plus required completion audits.
5. Recheck local DB/logs to confirm the live loop reaches checkpoint or a
   concrete checkpoint failure instead of spinning forever.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm typecheck` passed.
- `pnpm test:diff` reached and passed the full `packages/assistant-runtime` suite, then failed on `packages/cli/test/runtime.test.ts` timeout; the single failing CLI test passed on direct rerun.
- Focused hosted-local Linq stale-wake E2E passed once before assertion strengthening. After strengthening, two reruns were blocked before stale-wake setup by unrelated activation `checkpoint.snapshot_failed` 409 / runner retry cap in overlapping snapshot/R2 work.
- Five read-only subagent reviews completed; liveness, concurrency, architecture, coverage, and privacy/ops feedback was applied where relevant.

## State

- Live local DB shows the hosted workspace still checkpointed at version 81 from
  May 18 while mailbox rows have advanced to today.
- Runtime logs show hundreds of repeated zero-import foreground passes,
  `assistantAutomationProgressed=false`, `progressed=true`, and
  `checkpoint.runtime_residue_deferred` with `canonical_runtime_commit`.
- Current diagnosis: repeated wake probes keep presenting the old due workspace
  wake to the assistant phase because uncheckpointed projected wake state is not
  carried into subsequent in-invocation foreground passes.
- Implemented the fix in `packages/assistant-runtime/src/hosted-runtime.ts` by
  projecting accumulated wake metadata onto the workspace used for dirty-window
  foreground passes.
- Latest read-only local DB aggregate showed no matching hosted runtime residue,
  assistant pass, mailbox import, or snapshot failure events in the last 15
  minutes using UTC comparison. Treat shared local Linq state as noisy because
  another user is running it locally.
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
