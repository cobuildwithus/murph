# Absorb covered late device requests before background completion

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Goal and protected invariant

Avoid a second empty background invocation for scheduled device requests that arrive during an already-admitted pass. Preserve foreground priority, exact completion authority, durable mailbox prefixes, and every uncovered obligation.

## Owner and evidence

The runtime imports its initial mailbox once, while workspace system work records completion after checkpoint. Existing retained-device compaction can cover later scheduled hints only if those hints are locally imported before recording. The returned progress currently uses the initial import. ReviewGPT recommended one bounded tail before the existing completion checkpoint; no second device pass or cadence publisher is needed.

## Scope and decisions

- Reuse the workspace runner importer, shared invocation budget, checkpoint builder, and existing post-checkpoint recording/retention.
- Import at most one system prefix after admitted work quiesces and before its completion checkpoint. Project the latest import and finish each import's effects once after a covering checkpoint.
- Preserve original claims, admission time, completion preparation, retry deadlines, and fresh versus restored/yielded authority.
- Keep container lifecycle, size, polling intervals, Web preflight, and retained-history scheduling changes outside this PR.
- State stays in existing mailbox import and system mailbox owners. Add no wire or persisted schema.

## Failure and deployment

Foreground, abort, receipt capacity, and shared budget can stop the tail. Rows after the bounded read remain ordinary durable follow-up work. Interrupted publication and follow-up checkpoints retain existing recovery. Runtime-image-only rollout supports old and new images with current Web/Worker; old images retain the extra invocation cost. Rollback changes efficiency, not ownership.

## Tasks

1. Reproduce late scheduled arrival with the composed workspace entrypoint and retained future jobs.
2. Add the bounded import at the existing completion checkpoint and carry current progress/effects.
3. Prove uncovered work, budget, after-bound arrivals, preemption, and checkpoint recovery; run focused tests and runtime typecheck.
4. Review privacy, complexity, and owner docs; open PR, start final ReviewGPT with CI, and close the plan after all gates.

## Verification

- The covered late-arrival regression failed on the base: the late request was not imported and its effect never ran.
- Eleven focused cases pass: covered/equal/manual/epoch/connection boundaries, after-bound input, shared budget, foreground and abort during fetch, initial checkpoint failure, follow-up failure, and cold restore preserving exact future jobs.
- Runtime typecheck passes. Existing composed container tests pass for both completion/response arrival orders.
- Focused owner suites pass: 242 tests across system-mailbox notification and composed workspace entrypoint. Final ReviewGPT passed on the source candidate; final-head CI is tracked by PR #3476.
- Complexity guard passes: file debt 493 -> 493; maximum 233 unchanged. The new helper stays below 20; existing large owner functions retain their boundaries.

Local proof uses synthetic data only. Production physical-start improvement requires deployment and a later observation window; do not equate avoided logical executions with measured physical starts.

## Completion review

- PR: https://github.com/cobuildwithus/murph/pull/3476
- Reviewed source head: `5457852b037417eaf44fd47b33163066844ead94`.
- ReviewGPT: PASS, verified `gpt-6-pro`, response SHA-256 `948830677ad0105cfff1d15b22678c01169cba5a481c5a470cc952ead193b998`. No qualifying findings; exact review target closed.
- Parent review confirmed original completion authority, bounded import and retry state, once-only effects, unchanged device/provider work, and no private evidence in the patch.
- Only this plan's explanatory closeout follows the reviewed source candidate. Final exact-head CI remains the PR completion gate; no deployment is claimed.
- Larger retained-history scheduling changes remain separate.
Completed: 2026-09-15
