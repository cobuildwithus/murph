# Require Fable UI completion review

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Require a second-model UI review through Claude Code for every user-facing
  `apps/web` change, using Fable when available and Claude Opus as the allowed
  fallback.

## Success criteria

- The completion workflow makes the Claude Code UI double-check mandatory
  without replacing the existing local `frontend-review` pass when that pass
  applies.
- The workflow defines a bounded, review-only Fable invocation, the Opus
  fallback, the evidence packet, and finding-resolution expectations.
- A focused workflow guard proves the new requirement without restoring the
  retired Fable-first implementation route.
- Required scoped verification passes and the change is committed on `main`
  through the plan-aware helper.

## Scope

- In scope: `agent-docs/operations/completion-workflow.md`, the implementation
  versus completion-review clarification in `agent-docs/FRONTEND.md`, the
  matching canonical-doc inventory refresh in `agent-docs/index.md`, the
  focused workflow guard in
  `packages/cli/test/release-script-coverage-audit.test.ts`, and this task's
  plan and coordination row.
- Out of scope: frontend implementation ownership, runtime prompts, product
  behavior, application code, and any live UI implementation.

## Constraints

- Technical constraints: use a fresh non-interactive Claude Code review from
  the task checkout; keep the review read-only; do not depend on a local alias,
  reusable live session, or profile-specific path.
- Product/process constraints: preserve the existing Codex `frontend-review`,
  copy-only fast path, routed browser proof, verification, parent final review,
  and PR gates. Fable unavailability must not block completion when Claude Opus
  can run the same review packet.

## Risks and mitigations

1. Risk: reintroducing Fable accidentally makes it the UI implementation owner.
   Mitigation: place the rule only in completion review, mark it review-only,
   and retain the guard that keeps live implementation-routing docs independent
   of the retired Fable lane.
2. Risk: an unavailable Fable model blocks otherwise complete UI work.
   Mitigation: use one bounded Fable attempt, then the same Claude Code packet
   with Opus; record the selected route and any remaining Claude Code gap.

## Tasks

1. Recover the prior Claude Code/Fable invocation and the reason the old
   implementation lane was retired.
2. Add the mandatory review-only UI double-check and Opus fallback to the
   completion workflow.
3. Update the focused workflow guard, run scoped verification, and perform the
   required completion review.
4. Inspect the final diff for scope and identifier leakage, then finish through
   the plan-aware scoped commit helper.

## Decisions

- Keep implementation routing model-neutral. This task adds a completion-time
  second-model review only.
- Use the explicit Claude Code model routes `claude-fable-5` and `opus`; do not
  rely on the historical `cc` shell shorthand.
- Preserve the existing tiny copy-only exemption from local `frontend-review`
  and `coverage-write`; the separate Fable-or-Opus check is the review that now
  applies to every user-facing website UI change.
- Treat an unavailable route and a route that cannot return a usable review the
  same way. Completion cannot claim this check passed unless one route returns
  a usable review.

## Verification

- Commands to run: focused Vitest for the workflow guard; `pnpm test:diff` for
  the touched guard and workflow; `pnpm docs:drift`; `git diff --check`; direct
  readback and stale-policy searches.
- Expected outcomes: the new Fable/Opus review contract is present, retired
  Fable-first implementation routing remains absent, all focused checks pass,
  and no unrelated files enter the scoped commit.

Verification results:

- The focused Vitest filter for the completion requirement and retired
  implementation-route guard passed: 2 tests passed and 36 were skipped.
- `pnpm --dir packages/cli typecheck`, `pnpm docs:drift`, `git diff --check`,
  and the direct retired-route search passed.
- Both exact Claude Code model command shapes parsed under the installed CLI in
  no-call `--version` checks. No live Fable or Opus request was made.
- The final fresh `prompt-review` returned `NO FINDINGS` after earlier findings
  tightened implementation-versus-review wording, task-only untrusted evidence,
  complete safe-command guards, and fail-closed unusable-result handling.
- `pnpm test:diff agent-docs/operations/completion-workflow.md
  packages/cli/test/release-script-coverage-audit.test.ts` passed its syntax,
  architecture/privacy, dependency, package-boundary, and typecheck stages. Its
  full CLI package-test stage repeatedly hit existing 60-second timeouts in
  unrelated saved-vault, document/meal, intervention, provider/event, and
  experiment-journal scenario tests; the owning session stopped that run after
  the non-task pattern was established. The task's isolated policy tests pass.
Completed: 2026-07-16
