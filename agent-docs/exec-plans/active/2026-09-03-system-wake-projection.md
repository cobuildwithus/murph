# Keep device follow-up wakes visible

Status: active
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Stop a retained model-free device item from losing its exact retry deadline
  when an ordinary assistant wake also exists, so connected-health work resumes
  on its owned schedule instead of being repeatedly re-admitted by Temporal's
  unchanged-progress backoff.

## Product UX Patch

- Outcome: connected-health imports continue reliably without invisible
  repeated background churn.
- Reaches: an existing member whose retained device work and assistant schedule
  are both present in the same restored workspace.
- Proof: a production-shaped runtime regression shows the model-free wake stays
  canonical while the assistant wake remains available through its existing
  independent default-processing projection.

## Success criteria

- A focused test reproduces the current assistant-over-device projection before
  the implementation change.
- With a retained device follow-up, the workspace's canonical model-free
  `nextWakeAt` selection retains the device deadline and the assistant deadline
  remains available only through `nextDefaultProcessingWakeAt`.
- Foreground conversation, explicitly approved assistant continuations,
  assistant-execution blocking, and backed-off model-free work keep their
  existing priority.
- Focused tests, package typecheck/build as required, complexity review, final
  cross-cutting review, and exact-head CI pass.

## Scope

- In scope: assistant-runtime wake selection, deterministic regression coverage,
  current owner documentation, and the member-visible changelog decision.
- Out of scope: payload-hash recovery, provider cadence, mailbox row repair,
  Temporal workflow implementation, production mutation, and deployment.

## Constraints

- Technical constraints: Web remains the canonical checkpoint owner, Temporal
  remains pointer-only, and the runtime remains the sole semantic timer owner.
  Reuse the existing `nextDefaultProcessingWakeAt` projection; add no scheduler,
  queue, database field, compatibility layer, or feature-specific mode.
- Product/process constraints: preserve foreground reply priority and durable
  mailbox ordering; keep production evidence aggregate and private; use a
  dedicated worktree, focused local proof, a scoped commit, and a draft PR.

## Risks and mitigations

1. Risk: always preferring a model-free wake could delay genuinely runnable
   assistant work.
   Mitigation: preserve the independent default-processing projection and test
   due, future, blocked, and no-model-free cases.
2. Risk: a runtime-only correction could disagree with the deployed Temporal
   reader.
   Mitigation: change only the already documented additive projection contract
   and prove the supported current field shape without introducing a new wire
   field.
3. Risk: a retained device completion fence could be mistaken for provider
   cadence and re-run external work.
   Mitigation: reproduce with the retained mailbox owner and assert wake
   projection only; keep device execution semantics unchanged.

## Tasks

1. Trace the current wake-selection owner and the changes since the earlier
   starvation fix.
2. Add and run a focused failing regression for a runnable retained model-free
   item plus a competing assistant wake.
3. Collapse wake selection onto the existing split projections at the runtime
   owner boundary.
4. Run focused tests, typecheck/build, Product UX walkthrough, complexity guard,
   and parent diff review.
5. Commit, push, open a draft PR, complete exact-head review/CI gates, and record
   deployment verification.

## Decisions

- Treat this as a Product UX Patch: it restores the existing connected-health
  continuation promise without adding a member-facing surface or behavior.
- The canonical system wake and default-processing wake are already separate
  facts. The correction should derive their projections from those owners
  rather than persist another timer.
- Production aggregates prove the symptom spans multiple runtimes. The affected
  workspace rows carry the current progress-generation projection, so missing
  payload hashes are a separate recovery concern rather than this churn's
  cause.
- The reproduced cause is the system-mailbox checkpoint selector copying an
  assistant deadline into both the canonical wake and the additive default wake
  after a device item records its own follow-up deadline. Preserve a due
  foreground handoff and an exact default-owned system barrier, then keep the
  device and assistant deadlines in their existing separate fields.
- The canonical selection still compares the device deadline with mailbox
  import retries and other non-assistant candidates; the fix removes only the
  duplicate assistant candidate from that ownership decision.

## Product UX Walkthrough

- Person and path: an existing member with connected-health work that reports a
  follow-up deadline while a reminder is already due.
- Evidence: the production-shaped entrypoint scenario returns the reminder for
  immediate handling, checkpoints `device-sync.reconcile` at the exact follow-up
  time, and independently checkpoints the reminder through
  `nextDefaultProcessingWakeAt`.
- Recovery: future and due default-owned mailbox barriers, blocked assistant
  execution, and foreground wake coverage remain green; no new surface, delay,
  or authority is introduced.
- Difference from plan: none.
- Verdict: Ready.

## Verification

- Commands to run: focused assistant-runtime Vitest before and after the fix;
  package typecheck and build if the public package boundary changes;
  `pnpm complexity:diff`; `git diff --check`; exact-head required CI; final
  ReviewGPT because wake ordering and hosted execution are cross-cutting.
- Expected outcomes: the regression fails on the current branch, passes after
  the smallest implementation change, existing wake-priority coverage stays
  green, and no changed-file complexity hotspot is introduced.
- Pre-fix proof: the due-assistant scenario returned the expected immediate
  assistant handoff but failed because its final checkpoint replaced the
  three-minute device follow-up with the already-due assistant timestamp.
- Current proof: six focused runtime files pass (246 tests), and the
  assistant-runtime package typecheck passes.
- Rebased proof: after the adjacent model-free-frontier change landed on the
  base, the same six focused files pass (247 tests), the package typecheck
  passes, and the changed runtime file adds no cyclomatic-complexity debt.
- Changelog: attribute PR #2770 to the existing
  `background-work-recovers-in-order` outcome instead of publishing a duplicate
  connected-health recovery item.
