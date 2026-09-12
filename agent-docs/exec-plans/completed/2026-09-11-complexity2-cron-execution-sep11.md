# Simplify claimed cron notification handling

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and invariant

Make the claimed cron coordinator easier to review without changing scheduled
execution, authorization, retry, delivery, or cleanup. The existing cron owner
retains every state write and effect; no schema or durable owner changes.

## Evidence and scope

The complexity guard reports executeClaimedAssistantCronJob at 124. Its
notification input construction interleaves fixed delivery projections with
live authorization callbacks, then interleaves result classification with
partial execution evidence. Extract only the fixed delivery projection and
notification outcome decision into private synchronous helpers. Preserve all
callbacks, partial result evidence, recovery, catch/finally, and locked
finalization visibly in the coordinator. No arbitrary complexity threshold
justifies splitting those coupled effects.

## Protected ordering

- Lifecycle cleanup precedes stale-notification suppression.
- Provider admission remains the maintenance replay barrier.
- Session/decision evidence survives a later result-classification failure.
- Accepted pending delivery wins over subsequent errors and foreground yield.
- Foreground disposal, finish timestamp, and maintenance disposal keep their order.
- Canonical claim matching precedes append; local append precedes store reads.
- No prompt, schema, invocation authority, model selection, or provider input changes.

## Proof and completion

Run focused cron runtime/channel/threshold/history/dedupe/authority contracts,
assistant-engine typecheck, and complexity diff with bounded workers. Extend
composed regression coverage for partial result evidence and pending-delivery
precedence if needed. Inspect the full diff and privacy, then close this plan,
commit, push, and open a draft PR. Parent owns candidate review, Ready, exact-head
CI, ReviewGPT, and merge. Internal refactor requires no changelog.

## Verification results

- Focused Vitest: runtime, channels/branches, output history, thresholds,
  notification dedupe, and invocation authority; 6 files, 260 tests passed
  with one worker. New composed cases preserve callback-only parent intent,
  provider decision, session, and response through success or classification
  failure, without admitting a second notification attempt.
- `pnpm --filter @murphai/assistant-engine typecheck`: passed.
- `pnpm complexity:diff`: passed; file debt 123 -> 105 and maximum 124 -> 106.
  The remaining coordinator complexity owns coupled effects and partial
  evidence. Existing route authorization (37) and managed-owner authorization
  (22) are unchanged; no new helper exceeds 20.
- `git diff --check`: passed. Full diff preserves callback authority checks,
  partial evidence before classification, group recovery, catch/finally order,
  and the local/canonical locked persistence distinction.
- No prompt, tool contract, assistant instruction, or interpretation changes;
  deterministic execution-boundary proof is the relevant local evidence.
- Frog list reviewed after ordinary frozen installation; no new repository
  workaround or task-owned friction entry was needed.
- Parent retains final candidate review, exact-head CI, ReviewGPT, and merge.
Completed: 2026-09-11
