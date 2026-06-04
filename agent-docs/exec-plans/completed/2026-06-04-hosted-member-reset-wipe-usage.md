# Wipe Hosted Usage During Member Reset

## Goal

Let the hosted member reset script wipe hosted AI usage state instead of
blocking when existing usage rows have non-skipped Stripe meter status.

## Scope

- Touch only `apps/web/scripts/reset-hosted-member-runtime.ts` and focused reset
  script tests unless verification exposes a script-local issue.
- Preserve the existing contact-routing behavior from the prior reset fix.
- Continue requiring post-reset usage counts to be zero.

## Plan

1. Remove preflight and in-transaction guards that reject non-skipped usage rows.
2. Add focused coverage proving non-skipped pre-reset usage counts are allowed.
3. Run focused reset tests, hosted web typecheck, diff hygiene, and review.

## Verification

- `pnpm --dir apps/web test reset-hosted-member-runtime-script.test.ts`
- `pnpm --dir apps/web typecheck`
- `git diff --check -- apps/web/scripts/reset-hosted-member-runtime.ts apps/web/test/reset-hosted-member-runtime-script.test.ts agent-docs/exec-plans/active/2026-06-04-hosted-member-reset-wipe-usage.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Privacy scan over touched files found only literal env/model names, not secret
  values or personal identifiers.
Status: completed
Updated: 2026-06-04
Completed: 2026-06-04
