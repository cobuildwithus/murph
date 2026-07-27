# PR 972 Current-Main Reconciliation

Status: complete
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Reconcile PR #972 with current `main` without rewriting its published,
  reviewed history.
- Preserve current-main behavior and every Stripe billing, refund, privacy, and
  product-critical invariant already proved by the PR.

## Scope

- Merge `origin/main` into `agent/stripe-billing-hardening`.
- Resolve only the overlapping hosted billing, privacy cleanup, design catalog,
  testing-map, and focused regression files reported by Git's merge analysis.
- Run focused conflict-surface checks plus canonical `pnpm test:diff` and
  `pnpm verify:acceptance` on the resolved merge head.
- Update PR #972's exact head, change-shape statistics, verification evidence,
  mergeability, and CI state.

## Constraints

- Prefer the current-main implementation when the PR does not intentionally
  replace it.
- Preserve the PR's Stripe-canonical payment, refund, dispute, customer-balance,
  reservation, and entitlement-convergence behavior.
- Do not resolve conflicts by selecting one side wholesale when both sides own
  independent behavior.
- Do not rerun ReviewGPT solely because the base branch moved; rerun CI on the
  reconciled head.
- Keep unrelated worktree and coordination-ledger rows untouched.

## Verification Plan

1. Inspect every conflict and its base/ours/theirs intent before resolution.
2. Run scoped typecheck, lint, and the directly affected web/CLI tests.
3. Run `git diff --check` and inspect the merge-resolution delta.
4. Run canonical `pnpm test:diff` and `pnpm verify:acceptance`.
5. Close the plan with the merge commit, push, and update PR #972.

## Result

- Merged `origin/main` through ordinary Git history and resolved all 21
  overlapping files without dropping either current-main account-deletion
  ownership or PR #972's Stripe billing and refund convergence behavior.
- Preserved the current-main fresh-choice boundary for a just-paused Pulse
  trial and prevented ordinary Stripe billing writes from including the
  account-deletion `suspendedAt` fence.
- Focused verification passed:
  - 584 conflict-surface web tests.
  - 94 tests for the final billing-start and billing-policy corrections.
  - Web lint and TypeScript checks.
  - 40 release-script audit tests, with one environment-gated test skipped.
- Canonical `pnpm test:diff` for the final web corrections passed in Testbox
  `tbx_01kygwz5xqcwj35k6bxddj38v9`, including 7,307 runnable web tests, lint,
  TypeScript, dev smoke, and the production build.
- Canonical `pnpm verify:acceptance` passed in Testbox
  `tbx_01kygx449fzkfcpe6jd0824pxy`, including package coverage, app
  verification, and Cloudflare Workers tests.
- An earlier broad CLI diff attempt exposed unrelated Testbox timeouts in
  unchanged CLI suites. The exact edited release audit passed locally, and the
  later full canonical acceptance run passed the complete CLI coverage lane.
