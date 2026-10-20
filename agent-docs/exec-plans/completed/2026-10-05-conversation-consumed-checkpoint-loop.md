# Converge consumed conversation checkpoints without repeated maintenance wakes

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

Stop repeated empty default invocations caused by retaining acknowledged
conversation inputs behind a stale checkpoint consumption frontier.

## Success criteria

- A synthetic restored workspace with more than 50 terminal inputs and empty
  imports converges to its far future default wake in one invocation.
- Authoritative consumption advances monotonically even on empty imports;
  unacknowledged inputs remain retained and fresh foreground work stays runnable.
- Preserve the latest accepted system progress generation from #3998.

## Scope

- In scope: assistant-runtime consumption propagation and idle checkpoint
  ordering, focused regression proof, protocol documentation, local commit.
- Out of scope: Web/Temporal policy changes, new timers or schemas, production
  mutations, pushing, PR creation, and deployment.

## Constraints

- Postgres remains the acknowledgment authority. Reuse existing mailbox response,
  checkpoint status and pending-input compaction; add no persistent owner.
- Use synthetic evidence only. Keep all work in this checkout. Dependencies
  were ready before tests (`node_modules/.modules.yaml` exists).

## Risks and mitigations

1. Premature removal loses unacknowledged inputs: compact only through a
   server-provided committed frontier; test retained and fresh inputs.
2. Stale reads regress status: preserve the maximum valid consumed frontier.
3. Idle reordering regresses system progress: preserve #3998 and run its proof.
4. Deployment skew: preserve existing wire fields and snapshot readability;
   runtime-only behavior should converge old snapshots without Web changes.

## Tasks

1. Add and run a composed regression on unchanged source; record the failure.
2. Correct propagation at the import owner and compact before projecting wake.
3. Run focused runtime tests, typecheck, complexity and docs drift checks.
4. Review privacy, ownership and the complete diff; close this plan and commit
   through scripts/finish-task. External review/CI remain later release gates.

## Decisions

- Internal resource/recovery correction with no new member-facing feature or
  copy; no public changelog entry is needed.
- No model prompt/tool/reply policy changes: deterministic runtime proof owns
  the regression; no real-model journey is needed.

## Cause and correction

The import session remembered fetched consumption only in invocation-local state.
An empty import did not carry that authority into checkpoint redacted status.
Idle publication then inspected the pending-input index before its existing
checkpoint compaction. More than 50 retained terminal entries left inspection
incomplete and selected a synthetic 30-second default-processing wake, even
when the scheduled assistant wake was a day away.

The import owner now records only a strictly newer valid consumed floor in the
existing builder. Idle publication merges that status and runs the existing
acknowledgment-aware compaction before wake projection, passing its exact
handled-item selection to checkpoint creation rather than compacting twice.
No limit, timer, wire field, persisted format, or authority changes. The latest
accepted progress-generation read introduced by #3998 is unchanged.

## Verification

Dependencies were present before the first test. All evidence is synthetic.

1. Red proof on unchanged base source (before implementation, and reconfirmed
   with the final regression):
   `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-entrypoint-scheduling.test.ts -t 'converges a restored terminal-only index'`
   failed: expected the next-day default wake; received now plus 30 seconds.
   The same fixture also exposed checkpoint consumption staying at 0 rather
   than the fetched 64. Base-source rechecks restored edited source in `finally`.
2. The command above passes with the fix. It restores a snapshot containing 65
   terminal inputs, receives an empty import with committed consumption through
   64, publishes the far wake in one invocation, then restores and checkpoints
   again. Entry 65 remains retained and selected for acknowledgment; a fresh
   unconsumed input remains runnable. The assistant callback models an idle
   no-work phase; snapshot, import, checkpoint, compaction, and wake owners are
   real. A real assistant post-checkpoint callback can independently request a
   short continuation; this regression does not assert removal of that work.
3. `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-entrypoint-scheduling.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-checkpoint-progress.test.ts test/hosted-runtime-pending-input-index.test.ts test/hosted-runtime-pending-assistant-input.test.ts test/hosted-runtime-mailbox-checkpoint.test.ts`
   passed: 277 tests, six files. Includes #3998 progress publication, empty
   import advancement, older and absent floors, pending-input terminality,
   replay retention, wake scheduling and mailbox checkpoint behavior.
4. `pnpm --filter @murphai/assistant-runtime typecheck` passed.
5. `pnpm complexity:diff` passed. Runtime debt remains 465 and maximum 223;
   workspace-runner debt remains 58 and maximum 70. The changed idle publication
   hotspot remains 35. Sharing its existing cancellation signal avoids duplicate
   branching. No broad extraction of the established invocation owner is needed.
6. `bash scripts/check-agent-docs-drift.sh` passed; `git diff --check` passed.

## Parent review and delivery

Reviewed the complete source/test/doc diff, monotonic floor update, terminal
retention predicate, checkpoint cancellation, selection reuse, unchanged
#3998 generation read, privacy and scoped paths. The compaction was moved within
an already-quiescent checkpoint boundary; no database/network call or awaited
work was added before provider start. No prompts or provider input change.
The deterministic recovery journeys are Ready at this local boundary.

`scripts/frog list` was inspected; no new developer-friction entry was needed.
No production data or identifiers were copied into the proof or documentation.
Only this checkout was modified; no production reads or mutations were needed.

Deployment is runner-bundle behavior delivered through the existing Cloudflare
release path. No Web or Temporal change, wire migration, or coordinated consumer
rollout is required. Old runners may continue the loop until replaced. The
fixture demonstrates old checkpoint status being repaired by the new runner,
not a deployed mixed-binary fleet. Retain existing v2-index/runtime rollback
floors; this patch adds no format floor. Rolling back to a compatible older
runner can reintroduce the scheduling defect. Preserve #3998 in the release.
After an authorized rollout, verify the runner fingerprint, falling invocation
cadence, advancing consumed status and disappearance of unsupported near-term
default wakes. No rollout was performed here.

Unverified: live fleet convergence, release build/smoke, mixed Web/Worker and
warm-runner binaries, broad CI and final ReviewGPT. Push/PR/release operations
are explicitly outside this task; those gates remain for the release owner.

Completed: 2026-10-05
