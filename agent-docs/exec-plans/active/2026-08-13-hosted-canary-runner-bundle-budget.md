# Unblock hosted browser canaries at runner bundle assembly

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Restore the protected-main Junction and Stripe browser canaries by accepting
  the already-reviewed hosted runner graph at its current measured byte size.

## Success criteria

- The production runner bundle assembles within its explicit total byte budget.
- The entry-chunk and static-closure ratchets remain unchanged and the existing
  forbidden-boot-input guard still passes.
- Focused bundle tests, Cloudflare typecheck, exact-head CI, preliminary
  specialist ReviewGPT, and final ReviewGPT all pass.
- The change is merged and fresh protected-main Junction and Stripe canaries
  reach their browser scenarios without the pre-browser budget failure.

## Scope

- In scope: the runner entrypoint total-byte baseline, its mirrored policy test,
  PR verification/review, merge, and post-merge canary monitoring.
- Out of scope: changing runner behavior, removing runtime features, weakening
  entry/static closure budgets, or altering Junction/Stripe browser behavior.

## Constraints

- Technical constraints: use the larger exact macOS production measurement of
  10,204,553 bytes as the integrated baseline, retain the existing 32 KiB
  allowance, and confirm the Linux measurement remains below that baseline.
- Product/process constraints: preserve existing worktree edits, keep diagnostics
  metadata-only, and use the guarded task-worktree/PR/ReviewGPT path.

## Risks and mitigations

1. Risk: raising the budget could hide an accidental eager dependency.
   Mitigation: retain the stricter entry/static ratchets and forbidden-input
   guard, inspect the metafile report, and update only the total baseline.
2. Risk: the canaries could still contain a browser-level defect after assembly.
   Mitigation: merge only after exact-head CI/review and monitor both fresh
   protected-main canaries through their terminal browser outcomes.

## Tasks

1. [done] Record the CI reproduction and confirm both workflows share the same blocker.
2. [done] Ratchet the total-byte baseline and mirrored test to the measured value.
3. [done] Run focused bundle assembly, tests, typecheck, and inspect the final diff.
4. [active] Commit/push/open the PR; run preliminary and final ReviewGPT with CI.
5. [pending] Resolve findings, merge, and monitor fresh protected-main canaries.

## Decisions

- Use a measured baseline update rather than deleting or restructuring runtime
  code: the overage is 624 bytes, the provider graph is already reviewed and
  required, and no forbidden boot subsystem entered the graph.
- The direct macOS assembly measured 10,204,553 bytes, 34,230 bytes above Linux;
  use that larger cross-platform measurement because the Linux-only baseline
  still exceeded the existing allowance on macOS by 1,462 bytes.
- Treat this as one deploy blocker because both Junction and Stripe stopped at
  the identical runner assembly boundary before either browser scenario began.

## Verification

- Commands to run:
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/runner-bundle-entrypoint-bundle.test.ts`
  - `pnpm --dir apps/cloudflare runner:bundle`
  - `pnpm --dir apps/cloudflare typecheck`
  - `git diff --check`
  - exact-head required GitHub checks and both ReviewGPT passes
  - fresh protected-main Junction and Stripe canary workflows
- Expected outcomes: every command passes; bundle output reports the measured
  total under the new baseline plus unchanged allowance; both canaries proceed
  beyond assembly and finish successfully.
