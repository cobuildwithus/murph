# PR 586 Merge Conflict Resolution

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Reconcile PR 586 with current `main`, preserve both the browser-vault speed
  work and compatible base-branch behavior, and restore a conflict-free PR
  head.

## Success criteria

- The PR branch contains a normal merge from current `origin/main`.
- Every manual conflict is resolved from code-path evidence rather than a
  blanket side choice.
- Focused conflict-path verification and the truthful diff-aware app lane pass.
- The resolved merge is committed, pushed, and GitHub reports no merge conflict.

## Scope

- In scope: the three files reported by the merge preview, any directly required
  tests, task coordination artifacts, and the merge commit itself.
- Out of scope: unrelated cleanup or changes to the PR's intended behavior.

## Constraints

- Preserve browser-vault privacy, auth/session invalidation, billing-state
  ownership, and hosted-local E2E fidelity.
- Preserve unrelated working-tree and coordination-ledger edits.
- Do not include secrets, direct identifiers, or local paths in committed text.

## Tasks

1. Inspect the base, PR, and `main` versions of each conflicting hunk.
2. Merge current `origin/main` and resolve each conflict at the owning boundary.
3. Run focused tests, truthful diff-aware app verification, required audits, and
   parent final review.
4. Close the plan in the merge commit, push the PR branch, start ReviewGPT with
   CI, and confirm GitHub mergeability.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-member-store.test.ts`
  passed 61 tests.
- `pnpm test:diff apps/cloudflare/test/hosted-local-onboarding-followup-e2e.test.ts apps/web/src/lib/hosted-onboarding/hosted-member-billing-store.ts apps/web/test/hosted-onboarding-member-store.test.ts`
  passed the full affected app lane: 4,609 web tests, 1,736 Cloudflare tests,
  lint with zero errors, typecheck, production build, development smoke, and
  repository guards.
- The resolved Cloudflare E2E file is byte-identical to `origin/main`; the
  retained 40-hour bound covers the maximum next-day 13:30 schedule offset,
  including the daylight-saving fallback margin.
- The final billing-store and member-store-test diff against `origin/main`
  contains only the PR's narrow home billing projection and its exact Prisma
  selection assertion. Main's Stripe mutation lock and Linq routing tests are
  retained unchanged.
- Security/privacy review reported zero concrete medium-or-higher findings.
  Coverage-write review reported zero high-value proof gaps and made no edits.
- `git diff --cached --check`, conflict-marker search, and privacy/path checks
  passed.
Completed: 2026-07-13
