# PR 992 Family-owner base reconciliation

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Reconcile PR #992 with the newest `origin/main` while preserving both the
  usage-referral experience and the newer Family-owner low-usage behavior.

## Success criteria

- Resolve the low-usage prompt conflict without dropping referral missions,
  anti-gaming safeguards, or current Family owner-aware wording.
- Preserve both branches' auto-merged Assistant Engine tool contracts.
- Run focused prompt/tool tests and typecheck, push the merged head, and confirm
  GitHub reports the PR conflict-free.

## Scope

- In scope: the latest base merge, its single prompt conflict, directly affected
  Assistant Engine verification, push, and PR status.
- Out of scope: unrelated base-branch changes, deployment, or ReviewGPT round 8
  without explicit user authorization.

## Decisions

- Keep the referral mission as an optional first question for trial, paid, and
  hosted-group contexts.
- Use a fresh Family status read for owner-aware second- versus third-person
  wording, and repeat that read on Family follow-up before any private handoff.
- Preserve generic active-group guidance and keep qualification counters and
  other anti-gaming thresholds server-only.
- Accept the newest base's removal of the coordination ledger; this plan follows
  the replacement branch-local plan process.

## Verification

- Repository conflict-marker scan and `git diff --check` passed.
- Focused Assistant Engine prompt, plan-usage, and group-tool suite: 70 passed.
- `pnpm --filter @murphai/assistant-engine typecheck` passed.

## Tasks

1. Merge current `origin/main` and resolve the prompt conflict from both owner
   contracts.
2. Run focused verification and inspect auto-merged Assistant Engine seams.
3. Close the plan, push the exact head, and confirm PR mergeability.
Completed: 2026-07-27
