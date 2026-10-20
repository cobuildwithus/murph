# Clarify documentation guard diagnostic

Status: completed
Created: 2026-10-19
Updated: 2026-10-19

## Outcome and invariant

Explain that the configured path guard covers ordinary code/process edits without
implying every match changes architecture. Preserve path matching, documentation
and plan acceptance, thresholds, exit statuses, and review gates.

## Cause and scope

Frog issue #4205 is bound to
`.agents/friction-log/20261018223932-docs-drift-requires/friction.md`.
Murph supplies an architecture-specific label to the existing repo-tools drift
delegate, although its path matcher includes ordinary Web edits. Correct only
that label in `scripts/repo-tools.config.sh`; do not narrow the guard.

## Decisions

- Reuse the existing consumer configuration and installed delegate; add no logic.
- Retain the original issue binding; no new Frog report is needed.
- Internal developer diagnostic only: no member changelog, provider-input,
  production behavior, or deployment change.

## Tasks

1. Compose base and candidate configuration with the actual installed delegate.
2. Verify UI-only and UI-with-test failures, plus active/completed-plan success.
3. Run shell syntax and repository documentation checks; inspect the final diff.
4. Complete parent review, scoped commit, exact-head ReviewGPT and required CI.

## Verification

- Passed eight composed before/after cases against the actual installed repo-tools
  0.1.18 delegate, independently verified against registry integrity. UI-only and
  UI-with-test changes still fail; active and completed plan additions still pass.
  Diagnostic output changes only by the configured label replacement.
- Passed `bash -n scripts/repo-tools.config.sh`, `pnpm docs:drift`,
  `pnpm docs:gardening` (zero issues), and `git diff --check`.
- Parent candidate review accepted the bounded diff and preserved guard behavior.
- TypeScript typechecking and complexity metrics do not apply: the sole
  executable change is a shell diagnostic string.
- Exact-head ReviewGPT, required CI, merge and issue closure remain PR gates;
  this plan records completed implementation and focused local proof.
Completed: 2026-10-19
