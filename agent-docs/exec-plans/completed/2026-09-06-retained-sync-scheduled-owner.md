# Preserve scheduled reconciliation during retained sync recovery

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Goal and scope

Correct the accepted PR #3003 review finding with the smallest change to existing mailbox eligibility. Keep scheduled reconciliation independently owned until a strictly later cadence proves it superseded. Preserve provider jobs, backoff, connection epochs, checkpoint recovery, and foreground priority. Add no state, abstraction, dependency, or scheduling mechanism.

## Evidence and decision

The retained job hint copies the current account cadence; equality does not prove the scheduled tick ran. Resource continuation passes bypass the reconciliation scheduler, and resource success can leave that cadence unchanged. Therefore the equal-cadence scheduled tick must survive. Missing cadence also cannot prove supersession.

## Tasks and verification

1. Extend the real workspace entrypoint regression with production-shaped scheduled payloads and checkpoint restore; reproduce loss of the equal-cadence tick on the reviewed head.
2. Tighten existing eligibility and prove a successful resource retry is followed by scheduled reconciliation and canonical cadence advancement. Preserve absorption of superseded ticks and exact future job timing.
3. Run focused mailbox suites, runtime typecheck, complexity checks, and parent review.
4. Update the owner contract and PR evidence, commit, run required review round 2 concurrently with exact-head CI, then merge, deploy through the managed workflow, and inspect production progress.

## Product UX and risks

Connected-device recovery must clear redundant requests without losing periodic sync. Equal, newer, undated, explicit, and lifecycle work retain their existing execution owner. No schema or interface change is needed; normal immediate runtime rollout applies.

## Implementation outcome

- The new real-entrypoint regression failed on the first-reviewed head: the equal-cadence scheduled item was removed.
- The corrected run preserves that item through restore and a successful WHOOP resource request. A later pass executes scheduled reconciliation, advances the canonical cadence, and drains the queue. The superseded-schedule case still absorbs redundant hints without advancing the provider retry.
- All 200 tests passed across mailbox notification, real workspace entrypoint, foreground preemption, and mailbox state suites. Runtime package typecheck and `git diff --check` passed.
- `pnpm complexity:diff` passed with unchanged debt 20 and maximum 30. Parent review confirmed the existing two hotspots are unchanged, no new abstractions or state were added, and private data stays outside artifacts.
- PR #3003 retains the release gates: review round 2, exact-head CI, merge, managed deployment, and read-only production convergence inspection.
Completed: 2026-09-06
