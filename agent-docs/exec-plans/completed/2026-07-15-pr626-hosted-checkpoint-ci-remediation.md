# PR 626 hosted checkpoint CI remediation

## Goal

Close the exact-head hosted-checkpoint CI failure and ReviewGPT's retry-loop
finding without weakening ordering, durability, or duplicate-reply proof.

Success criteria:

- The scenario observes the second natural idle snapshot after cold restore.
- That snapshot proves no runtime wake remained pending, the runner leaves its
  write fence, mailbox lag is zero, and no runtime error is present.
- The scenario still proves two exact replies, two provider requests, and no
  duplicate work during the post-checkpoint stability window.
- Invocation-local repair only replays a nonempty proper suffix of the selected
  inputs; bootstrap-gap retries remain durable for their scheduled wake.
- Focused verification, exact-head CI, and ReviewGPT pass before merge.

## Evidence

- Exact-head CI completed the restored reply exactly once with two provider
  requests and zero mailbox lag.
- The second natural idle snapshot recorded
  `runtimeWakePendingAtCheckpoint=false`, after which the runner was no longer
  in flight and no immediate alarm was scheduled.
- The test timed out only because it still required an assistant pass after
  that snapshot. That pass used to consume stale local batch residue; the
  clean-progress ordering repair now removes the resolved residue before the
  checkpoint boundary, so the no-op pass is intentionally absent.
- ReviewGPT Round 6 proved that `progressed=true` plus zero failed replies does
  not itself prove selected-input retirement: the supported inbox-bootstrap gap
  retains every selected input and schedules a 30-second retry. Rebuilding that
  all-pending selection locally would bypass the retry owner and spin.
- The focused hosted-local shutdown/checkpoint scenario passed through the real
  web, Temporal, Cloudflare, container, provider-stub, and Linq stack in 277
  seconds using the exact production-head Linux runner artifact.
- Final owner verification passed with 1,674 assistant-runtime tests, 1,819
  Cloudflare tests, package coverage, both affected typechecks, and the required
  coverage-write proof of a multi-input all-pending selection plus boundary.

## Approach

1. Replace the obsolete post-snapshot cleanup-pass condition with direct
   terminal-quiescence evidence from the natural snapshot and runner status.
2. Explicitly assert that no assistant pass follows the no-wake snapshot.
3. Reinsert selected records only when durable pending state is a nonempty
   proper suffix of the original selection; preserve the precomputed tail for
   all-pending, none-pending, or ambiguous shapes.
4. Add a bounded bootstrap-gap regression alongside the existing positive
   reply-failure case, retaining exact provider, reply, mailbox, and stability
   assertions.
5. Run focused package and Cloudflare validation, finish the scoped plan, push,
   and rerun ReviewGPT concurrently with exact-head CI.

## Constraints

- Keep retry scheduling with the existing assistant wake owner; add no new
  state, scheduler, or attempt manager.
- Do not shorten the forced-shutdown idle window.
- Preserve unrelated active-plan and working-tree changes.
- Do not expose secrets or direct personal identifiers in artifacts.

## State

Active.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
