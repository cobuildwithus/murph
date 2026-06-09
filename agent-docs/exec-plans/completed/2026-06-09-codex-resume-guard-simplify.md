# Simplify Codex resume-context guard after upstream proof

Status: completed
Created: 2026-06-09
Updated: 2026-06-09

## Goal

- Reduce the Codex app-server resume-context guard from PR #70 to its minimal
  correct form now that upstream Codex behavior is proven, without changing the
  guard's observable behavior.

## Success criteria

- The stale-resume guard keeps identical trip conditions and error shape
  (`ASSISTANT_CODEX_RESUME_STALE`, `mismatchedFields`, fail-closed before
  `turn/start`).
- The guard's reason to exist is documented in code: upstream Codex rejoins a
  loaded thread and ignores resume overrides with only a server-side warning
  (`codex-rs` `thread_processor.rs` `resume_running_thread`).
- Dead generality is deleted: the string-form sandbox echo arm that no Codex
  app-server version emits (`ThreadResumeResponse.sandbox` is always a
  `SandboxPolicy` object).
- The two duplicated interrupt-timeout regression tests share one scaffold
  while preserving both trigger paths (caller abort vs live interrupt) and
  their distinct assertions.
- Focused assistant-engine tests and typecheck pass.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant-codex.ts` (guard region only)
  - `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- Out of scope:
  - Resume RPC params, provider fallback behavior, docs invariants (all stay
    as merged in PR #70; upstream check confirmed they are correct).
  - New telemetry: `ASSISTANT_CODEX_RESUME_STALE` already flows through
    `isCodexDiagnosticTraceError` into `emitCodexResumeFailureTraceEvent`.

## Constraints

- Behavior-preserving only; no new abstractions beyond a small test helper.
- Preserve unrelated active ledger lanes (assistant-engine media-catalog lane
  touches different files).

## Tasks

1. Table-ize the guard field comparisons with one uniform skip-when-unset rule.
2. Delete the dead string-form sandbox arm.
3. Add the upstream-citation comment.
4. Collapse the duplicated interrupt-timeout tests into one parameterized test.
5. Run focused tests, typecheck, required audits, and close the plan.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-codex-runtime.test.ts --no-coverage`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm typecheck` (clean worktree, so the supplement-test blocker from PR #70
  does not apply here)
- `pnpm test:diff` scoped to the touched files.

## Progress

- Upstream proof captured: `ThreadResumeParams` accepts model/provider/cwd/
  approval/sandbox overrides; cold resume honors them via
  `build_thread_config_overrides`; loaded-thread rejoin ignores them with a
  server-side warning when subscribers remain; `ThreadResumeResponse` echoes
  the effective context with non-optional fields.
- Guard table-ized with one uniform skip-when-unset rule; dead string-form
  sandbox arm deleted; upstream-citation comments added.
- Duplicated interrupt-timeout regressions collapsed into one `it.each` with
  both trigger paths and distinct assertions preserved.
- Required Codex audit subagents (coverage-write on gpt-5.5,
  task-finish-review) were blocked by a Codex usage limit until 2026-06-10;
  the user explicitly authorized substitute Claude audit subagents for both
  passes in this turn.
- Coverage audit found one real gap: the null-actual filter branch was
  untested in both directions. Added one regression (missing echoed
  approvalPolicy + empty cwd, unrequested model/provider/sandbox echoed,
  absent thread id) asserting exact
  `mismatchedFields: ['approvalPolicy', 'cwd']`, and tightened the
  all-fields stale assertion from arrayContaining to the exact array.
- Final review approved: equivalence verified field-by-field; only residual
  risk is the upstream sandbox-shape assumption, which fails closed and is
  trace-observable; documented in a code comment.
- Verification green in this worktree: root `pnpm typecheck`;
  `bash scripts/workspace-verify.sh test:diff <both files>` exit 0; focused
  runtime suite 108 passed.
- `simplify` audit pass consciously skipped: the diff is itself a
  deletion-dominant behavior-preserving reduction (net -127 lines before
  review additions), so condition 4 of the simplify gate (extra review time
  justified by size and shape) is not met.
Completed: 2026-06-09
