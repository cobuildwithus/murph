# Remove the mandatory specialist audit

## Outcome

Land PR #2522 against current `main` with the mandatory preliminary specialist
audit removed rather than replaced by a local subagent. Preserve the independent,
risk-routed final ReviewGPT gate and ordinary parent review, focused verification,
exact-head CI, and mergeability requirements.

## Invariants

- No workflow rule requires a preliminary Product UX, prompt, frontend, coverage,
  or combined specialist audit.
- No workflow rule requires a local specialist subagent as a replacement.
- Product UX planning, direct walkthroughs, rendered frontend evidence, focused
  proof, parent review, risk-routed final ReviewGPT, and required CI remain intact.
- Obsolete specialist-only presets, prompts, packaging modes, tests, and references
  are deleted instead of retained as dead compatibility machinery.
- Historical completed plans remain immutable.

## Plan

1. Reconcile the existing PR branch with current `main` and resolve conflicts by
   preserving current unrelated workflow improvements.
2. Remove the preliminary specialist requirement and every now-unowned support
   path while keeping the final review gate and direct evidence contracts.
3. Run focused workflow/tooling tests, shell syntax checks, docs drift checks,
   typecheck, diff checks, and privacy review.
4. Close this plan in the scoped task commit, update the PR body, push the exact
   candidate, require green exact-head checks, prove current-base mergeability,
   and merge.

## Status

Implementation and local proof complete. The existing PR head was unowned
locally and had no active handoff or coordination reference. The branch was
reconciled with current `main` through an ordinary merge; the four conflicts
were resolved by preserving current final-gate toolchain behavior while deleting
the preliminary specialist path.

The live workflow owners now make Product UX, prompt, frontend, and coverage
proof parent-owned; neither a specialist audit nor a local subagent is required.
The obsolete specialist prompt, ReviewGPT preset, packaging phase, and related
tests are removed. The proportional exact-head final ReviewGPT gate remains.

Verification:

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/review-gpt-pr-head-preflight.test.ts packages/cli/test/review-gpt-package-concurrency.test.ts` — 10 tests passed.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts -t "exposes only the package-backed review-gpt runner|keeps Product UX decisions parent-owned without a specialist audit"` — 2 focused tests passed.
- `pnpm --dir packages/cli typecheck` — passed.
- `bash -n scripts/package-audit-context-full.sh scripts/review-gpt-pr-head-preflight.sh scripts/review-gpt.config.sh` — passed.
- `scripts/check-agent-docs-drift.sh` — passed.
- `git diff --check` and the identifier privacy scan — passed.

Final ReviewGPT is not applicable because the meaningful diff is limited to
internal docs, process, tests, and review tooling. Exact-head CI and current-base
mergeability remain required before merge.
Status: completed
Updated: 2026-08-31
Completed: 2026-08-31
