# PR 444 Latest-Main Recovery

Date: 2026-07-13
Status: active
Branch: `codex/pr444-conflicts-root-0713`
PR: #444

## Goal

Bring the recovered Call Circle branch onto the current `main` with ordinary
Git history, resolve only proven semantic conflicts, and make PR #444 genuinely
merge-ready without weakening the newer group, onboarding, phone-call, hosted
runtime, or privacy behavior already present on `main`.

## Starting Evidence

- Clean local head: `3936ea2c6daf09c5a9bb234c33d7fd5039c3ebfe`.
- Guarded remote PR head: `17c814a9774653daea37a0cab0440576ca711696`.
- Current remote `main`: `049c74af405af191a0d35442c20abc15174c86a5`.
- The local head contains the remote PR head and is 165 base commits behind.
- A read-only merge-tree simulation reports 19 conflict paths.

## Constraints

- Preserve Call Circle's web-owned authority, private member preferences,
  signed callbacks, provider fencing, and bounded scheduler behavior.
- Preserve current-main group membership, onboarding, orchestration, hosted
  runtime, Linq/Telegram, phone-call, and privacy invariants.
- Resolve conflicts by semantic union or deletion of obsolete overlap; do not
  add compatibility machinery without a proven deployed-state requirement.
- Preserve unrelated work and ledger rows. Do not touch PR #542 or #573. Do
  not merge PR #444.
- Keep heavy verification serialized and obey the memory/compression guard.

## Working Set

- The 19 conflict paths reported by the `HEAD`/`origin/main` merge simulation.
- Directly affected focused tests and generated artifacts only when required by
  the resolved owner behavior.
- This plan and its exact coordination-ledger row.

## Verification And Completion

- Inspect all three merge stages for every conflict and retain both applicable
  behavior sets with focused regressions for any non-mechanical resolution.
- Run focused owner tests and typechecks, then the repository-required
  acceptance/coverage lane serially.
- Run the required parent final review and specialist audits permitted by the
  current user instructions; use the exact pushed-head ReviewGPT PR loop with
  published `@cobuild/review-gpt` 0.5.106, Pro/current, and a 120-minute wait.
- Guard the remote PR head immediately before push, run ReviewGPT concurrently
  with exact-head CI, resolve actionable findings and review threads, and prove
  the final head conflict-free and merge-ready.
- Close this plan with `scripts/finish-task`; preserve the PR worktree because
  the open PR remains active.
