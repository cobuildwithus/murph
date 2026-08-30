# Fix initial device-sync wake convergence

Status: active
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Restore the existing device-sync follow-through promise: a fresh hosted
  `system_mailbox` invocation must import and process retained device work even
  when the runtime-wake signal that triggered or raced startup is already
  pending.

Product UX effort: Patch

- Outcome: connected wearable data can resume background import without an
  invisible start/recheck loop.
- Reaches: existing members with retained device-sync work across supported
  aggregator-backed providers; foreground conversation work keeps priority.
- Proof: a synthetic restored device item plus a pending system-mailbox wake
  reaches a provider pass, terminal mailbox acknowledgement, and quiescence.

## Success criteria

- The focused synthetic regression is red on the deployed base and green on
  the candidate.
- A pending default/foreground wake still preempts device work before import.
- A same-owner system-mailbox startup wake is consumed as orchestration context
  without preventing the initial system-lane import.
- The retained item is processed exactly once and the handled-through
  high-water advances without a new queue, scheduler, or persisted owner.
- Focused assistant-runtime tests and typecheck pass; exact-head CI and the
  required ReviewGPT stages resolve on the PR.

## Scope

- In scope: initial hosted runtime wake admission, system-mailbox import and
  device-item convergence, focused regression coverage, the existing member
  changelog outcome, and deployment-skew proof.
- Out of scope: production replay or resync, provider semantics, queue or
  Temporal mutations, broad mailbox refactors, and new orchestration state.

## Constraints

- Technical constraints: preserve foreground priority and canonical mailbox
  high-water authority; reuse the coalescing runtime-wake signal and existing
  system-mailbox owner; keep old/new Worker and runner bundles compatible.
- Product/process constraints: ReviewGPT authors every production-code patch;
  the local agent may author only the synthetic failing test, inspect and apply
  ReviewGPT's patch exactly, then own validation, Git, PR, and reporting.

## Risks and mitigations

1. Risk: consuming a startup wake could hide genuine conversation input.
   Mitigation: classify by requested processing mode and retain fail-closed
   default-owner handoff behavior with direct regression proof.
2. Risk: processing a stale retained item could duplicate provider work.
   Mitigation: keep existing mailbox dedupe, item identity, canonical write,
   and post-checkpoint record owners unchanged and prove exactly-once handling.
3. Risk: Worker/container rollout skew could reintroduce churn temporarily.
   Mitigation: preserve request/result schemas and document runner-first
   deployment plus fleet-fingerprint and bounded-invocation post-deploy checks.

## Tasks

1. Capture privacy-safe production aggregates and prove the root cause against
   current `origin/main` with a synthetic failing test.
2. Give ReviewGPT the exact root cause, failing test, owner files, invariants,
   forbidden actions, and verification commands; accept only a minimal patch.
3. Run focused tests, assistant-runtime typecheck, privacy/readback checks, and
   the Product UX walkthrough.
4. Commit, push, open the PR, and launch required exact-head ReviewGPT stages
   concurrently with CI.
5. Resolve findings under the repository boundary, complete the parent review,
   and report deployment concerns and residual production risk.

## Decisions

- Selected issue: pre-import early return when a fresh `system_mailbox`
  invocation begins with a pending runtime-wake signal.
- Rejected alternatives: no provider retry change, broad resync, queue change,
  new scheduler, or telemetry escalation; existing evidence is conclusive.
- Deduplication: merged PR #2568 fixes webhook admission and post-pass wake
  revalidation, while open PR #2575 fixes cold runner bundle convergence;
  neither covers this pre-import startup boundary.
- ReviewGPT implementation accepted: one production guard predicate permits
  only an explicitly classified `system_mailbox` startup wake to continue into
  import; default and unclassified wakes keep the conservative early handoff.
- Changelog: update the existing 2026-08-29
  `device-sync-follow-through` item with this PR as an additional source after
  GitHub assigns the PR number; the public outcome copy remains accurate.
- Completion blocker resolved: the implementation is now in a repository-
  sanctioned worktree created through `scripts/create-worktree`.

## Verification

- Red command: `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts --no-coverage -t "system mailbox mode runs already-imported pending device-sync without new mailbox rows"`
- Focused green command: rerun the focused system-mailbox test file after the
  ReviewGPT patch.
- Typecheck: `pnpm --dir packages/assistant-runtime typecheck`.
- Expected outcomes: the synthetic pending wake no longer suppresses system
  import; device work runs once; handled-through reaches the imported sequence;
  foreground-priority tests remain green.
- Red result on base: focused test failed because the system-lane fetch list
  was empty.
- Green result on candidate: the focused regression passed; the complete
  system-mailbox file passed 49/49; the explicit foreground-preemption test
  passed; assistant-runtime typecheck passed; `git diff --check` passed.
- Pending: changelog source update, scoped commit, push, draft PR, exact-head
  specialist and final ReviewGPT gates, CI, current-base merge-tree proof, and
  deployment handoff.
