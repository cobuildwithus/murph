# Prove complete Junction replay across retained device-sync wake

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Prove that the real Junction consumer completes the entire canonical smoke
  fixture after a checkpoint retains a connection-scoped retry owner, then make
  the hosted replay observe its complete dirty frontier within the original budget.

## Success criteria

- Preserve every fixture payload across the checkpoint and consume the retained
  wake at its existing retry deadline.
- Require successful jobs, exact payload acknowledgments and canonical imports;
  an empty dirty marker or an advanced mailbox frontier alone is insufficient.
- Keep autonomous Temporal delivery and the hosted E2E outcome explicitly unproven.
- Preserve strict model counts and Browser Vault content assertions while the
  direct-replay caller waits for dirty completion and rechecks current quiescence.

## Scope

- In scope: one focused assistant-runtime regression using existing real provider,
  importer, SQLite, mailbox and post-checkpoint acknowledgment owners; one narrowly
  scoped hosted Junction replay waiter and meaningful fake-clock coverage.
- Out of scope: production code, generic hosted completion behavior, fixture-volume
  changes, timeout increases, production reads or writes, and deployment. The parent
  completion owner handles the scoped commit, PR, final review and merge.

## Constraints

- Use the canonical testing entrypoint and committed synthetic fixture. The
  control-plane port is synthetic; provider execution and import persistence are real.
- Advance fake Date only at explicit consumer due boundaries. Do not replace the
  running hosted runtime or claim that a controlled yield reproduces a historical cause.
- Parent accepted the consumer proof and authorized the Junction-only waiter.

## Risks and mitigations

1. A payload acknowledgment can represent terminal failure.
   Mitigation: separately assert successful job states and canonical import receipts.
2. A generic completion wait permits future retries.
   Mitigation: test retained-owner consumption directly and keep hosted scheduling
   proof as a separate release requirement.

## Tasks

1. Inspect the existing consumer, dirty acknowledgment and fixture contracts. Done.
2. Add the narrow real-consumer retained-wake proof. Done.
3. Run the focused test and assistant-runtime typecheck, inspect privacy and diff.
   Focused proof, final typecheck, privacy and diff inspection pass.
4. Add a Junction-only waiter after parent proof review. Done; nine focused cases pass.
5. Complete Cloudflare typecheck, owner docs, PR body and final parent handoff.
   Source/test review accepted; Cloudflare typecheck passes. Owner docs and the
   complete PR body passed final readback. Parent review accepts all eight task
   files and the stated synthetic-control and durability limits. ReviewGPT and
   exact-head CI continue on the pushed candidate.

## Decisions

- Derive the resource count from the canonical fixture. Counts from separate failed
  runs do not establish a per-pass resource limit.
- Reuse the existing dirty owner and post-checkpoint acknowledgment paths; add no
  runtime state, dependency or abstraction.
- Generic hosted completion deliberately permits future retained work. The replay
  now additionally requires both dirty flags false and zero pending resources,
  then revalidates quiescence before returning current workspace state. The global
  continuation sequence list cannot identify this connection and is not a gate.
- One deadline covers every wait phase and is capped by the unchanged 540-second
  outer test budget. The existing 420-second waiter allowance is never renewed.
- Record the proven test-observation friction in
  `.agents/friction-log/20260911044945-hosted-junction-replay/friction.md`.

## Verification

- Focused command: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage --maxWorkers=1 --no-file-parallelism test/hosted-device-sync-runtime.test.ts -t 'a retained Junction smoke replay owner drains all payloads after a controlled yield'`.
  Final candidate: one test passed, 128 skipped; 5.81 seconds total, 1.19 seconds
  executing the proof. The runtime builder confirms 48 payloads, no dropped
  records and six groups of eight records. All payloads are acknowledged once
  with matching canonical source/resource import receipts; all persisted jobs
  succeed and canonical metric expectations pass.
- The retained deadline remains within the first pass's measured start/end plus
  30 seconds, and the persisted owner uses exactly that returned deadline.
- Typecheck: `pnpm --dir packages/assistant-runtime typecheck` passes after
  aligning the synthetic source inventory and platform-only credential fields
  with their current types.
- `git diff --check`, docs drift and complexity guards pass. The complexity
  guard excludes this test-only TypeScript change from production source debt.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage --maxWorkers=1 --no-file-parallelism apps/cloudflare/test/helpers/hosted-local-junction-replay-completion.test.ts`:
  nine tests pass in 154 milliseconds, including a future retained retry,
  continuation/status race, dirty blockers, shared deadline, failed-job evidence
  and a failed final status read.
- `pnpm --dir apps/cloudflare typecheck` passes on the final candidate.
- Limits: the control port is in memory; the service reopens the existing SQLite
  file and the canonical persistence callbacks are no-ops. No production Web
  transaction, snapshot publication/cache omission,
  autonomous mailbox selection or Temporal delivery is exercised. The controlled
  yield does not establish the historical hosted failure's cause.
Completed: 2026-09-11
