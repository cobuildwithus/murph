# Local Edge Upgrade Resource Missing

## Goal

Fix the local-dev `/home` and settings `Upgrade to Edge` failure when the hosted billing plan upgrade route receives Stripe `resource_missing` from the subscription item update.

Success criteria:

- The service either recovers from the mismatched Stripe subscription item state or reports enough safe metadata to diagnose the missing Stripe resource.
- No raw secrets, request bodies, full local paths, or customer contact data are logged.
- Focused hosted billing tests cover the behavior.

## Constraints

- Hosted billing and Stripe state are high-sensitivity surfaces.
- Preserve existing paid Pulse to Edge semantics; do not add a generic plan-transition engine.
- Do not touch unrelated dirty worktree changes.
- Existing coordination ledger has a stale-looking Stripe metadata row naming this service; keep this patch scoped and do not remove that row.

## Current Evidence

- Local route log shows `subscription.update.plan-items` failed with Stripe `resource_missing` status 400.
- Current safe Stripe error details include operation/type/code/status/request-id-presence but not which Stripe parameter/resource class failed.

## Plan

1. Inspect the subscription item selection and Stripe error normalization path.
2. Add the smallest recovery or diagnostic patch that fits the existing service.
3. Add focused Vitest coverage.
4. Run required hosted-web verification and completion audits.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/stripe.test.ts scripts/dev-hosted-local/stack.test.ts` passed.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/http.test.ts test/hosted-onboarding-billing-plan-change-service.test.ts` passed.
- `pnpm --dir apps/web lint` passed.
- `pnpm --dir apps/web typecheck` passed.
- `git diff --check -- <task files>` passed.
- `bash scripts/workspace-verify.sh test:diff <task files>` blocked before task tests on an unrelated raw-payload logging guard in `apps/cloudflare/src/runtime-bridge-workspace.ts`.
- `security-privacy-review` found local-env-source and generic-`param` logging issues; both were fixed.
- `coverage-write` reported the existing focused tests were sufficient and made no edits.
- `task-finish-review` found a local-price/pulled-secret mixing issue; it was fixed and the focused tests plus lint/typecheck were rerun.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
