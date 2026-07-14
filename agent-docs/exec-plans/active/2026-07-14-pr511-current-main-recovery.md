# PR 511 Current-Main Recovery

Status: active
Updated: 2026-07-14

## Outcome

Reconcile PR 511's accepted-conversation recovery and one-shot Linq participant
context patch with current `main` through ordinary Git history, preserve the
newer hosted authority and fresh-input invariants, close every proven
PR-specific CI failure, and publish one exact reviewed head without rewriting
or deleting either preserved recovery checkout.

## Evidence Boundary

- Remote PR head `c2c739de8e` is one PR commit based on `9a4a20a1fa`.
- Current `origin/main` is `a38e955389` and GitHub reports the PR conflicting.
- The old merge recovery, old linear recovery, and narrow one-shot branch are
  evidence only; none is safe to push blindly.
- Remote CI proves three underlying failures: a 21,367-byte runner static-boot
  budget overage, a stale workflow-wording assertion, and two warm-replay
  pending-index expectations that conflict with newer runtime behavior.

## Constraints

- Preserve the user-visible participant-context goal: participant webhooks do
  not wake or message; additions only inform the next accepted organic group
  turn and removals stay silent.
- Preserve exact accepted-conversation authority without authorizing adjacent,
  background, suspended-member, or stale-route work.
- Keep current `main`'s canonical Linq route authority, fresh foreground input
  priority, system-note ordering, and mailbox/checkpoint ownership.
- Add no new queue, scheduler, state owner, broad compatibility layer, or
  persisted concept.
- Do not rewrite, reset, delete, or signal the preserved recoveries or orphaned
  review process.

## Working Set

- The exact merge-conflict files produced by merging current `origin/main`.
- PR-owned hosted web, assistant-engine, assistant-runtime, Cloudflare, hosted
  execution, Temporal, schema/migration, test, and durable-doc paths already in
  the remote PR patch.
- A narrowly proven runner budget or test correction only if current `main`
  does not already close the corresponding CI failure.

## Verification Plan

- Compare every manual conflict resolution with the remote PR intent, current
  `main`, and both preserved recovery patches.
- Reproduce the three underlying CI failures on the reconciled tree and prove
  each resulting behavior, not only its assertion text.
- Run truthful owner-level `test:diff` coverage, focused direct participant and
  replay scenarios, relevant typechecks, and `git diff --check`.
- Run required security/privacy and coverage-write specialist audits, then the
  parent scope/call-path review and any affected re-audit.
- Close this plan with `scripts/finish-task`, guarded-push the exact PR head,
  update the PR description, and start exact-head ReviewGPT concurrently with
  CI. Do not merge.

## Progress

- Fresh isolated recovery worktree created from exact remote PR head.
- Read-only merge-tree proof identifies fourteen current-main conflicts.
