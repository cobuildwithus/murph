## Goal

Keep foreground user messages responsive when hosted device-sync work is noisy
or long-running. Success means a conversation item imported during a
device-sync wake is persisted for prompt prep and causes the current background
drain to yield so the runner can take the assistant reply path promptly.

## Constraints

- Preserve privacy: no raw webhook payloads, mailbox bodies, health data,
  user ids, account ids, local paths, or secrets in logs, tests, docs, or final
  output.
- Keep the fix small and architectural: foreground conversation input should
  preempt background maintenance without weakening checkpoint or runtime state
  invariants.
- Preserve unrelated dirty work, especially active device-sync dirty payload
  preseal edits outside assistant-runtime.

## Plan

1. Confirm the runner/device-sync phase boundary and existing tests.
2. Add a foreground-input notification boundary from the mailbox import loop to
   the assistant phase.
3. Teach hosted device-sync draining, deferred legacy device-sync recovery, and
   Junction daily timeseries imports to yield cooperatively when foreground
   input has arrived.
4. Add focused regressions for late foreground input, device-sync yielding, and
   Junction follow-up job scheduling.
5. Run targeted assistant-runtime tests and typecheck.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-events-coverage.test.ts test/hosted-runtime-system-mailbox-notification.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-maintenance.test.ts test/hosted-runtime-workspace-runner.test.ts` passed after wiring the foreground yield hook through queued system mailbox device-sync wakes.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm typecheck` passed.
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/junction-provider.test.ts` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-maintenance.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-runner.test.ts && pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/junction-provider.test.ts` passed after adding deferred legacy wake-lane coverage.
- `pnpm --dir packages/device-syncd typecheck` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm typecheck` passed after deferred wake-lane fix.
- `git diff --check -- <scoped files>` passed.
- `git diff -U0 -- <scoped files> | rg <privacy patterns>` returned no matches.
- `bash scripts/workspace-verify.sh test:diff <scoped files>` ran broad affected verification and was blocked by an unrelated `apps/cloudflare` hosted-local E2E runner expectation drift around Prisma-client prep spawn order/counts.

## State

- Local metadata confirmed active conversation input was imported at
  2026-05-26 22:41:05 UTC while canonical runtime commit residue continued
  until the assistant reply pass at 2026-05-26 22:48:29 UTC. The reply path
  was delayed by deferred/legacy device-sync recovery, not the normal timer
  lane alone.
- A second hosted-local signup/message flow confirmed a remaining route:
  a queued `device-sync.wake` system mailbox item invoked device-sync work
  without the foreground yield hook, so foreground conversation input could
  import while the device-sync wake continued draining canonical runtime
  commits.
- Assistant-runtime foreground import, timer lane, deferred legacy wake lane,
  queued system mailbox device-sync wake lane, and device-sync drain fix is
  implemented and verified.
- Junction per-job yield/follow-up scheduling is implemented and verified.
Status: completed
Updated: 2026-05-26
Completed: 2026-05-26
