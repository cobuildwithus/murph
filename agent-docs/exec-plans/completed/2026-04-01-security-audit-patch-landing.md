# 2026-04-01 Security Audit Patch Landing

## Goal

- Land the returned ChatGPT security-audit patch without overwriting unrelated in-flight work.
- Preserve the current repo behavior while tightening hosted bundle restore safety, reducing persisted Linq attachment URL exposure, and rejecting duplicate hosted device-sync runtime apply updates.

## Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `apps/web/src/lib/device-sync/internal-runtime.ts`
- `apps/web/src/lib/hosted-onboarding/contact-privacy.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-event-snapshots.ts`
- `apps/web/test/hosted-contact-privacy.test.ts`
- `packages/runtime-state/src/hosted-bundle.ts`
- `packages/runtime-state/src/hosted-bundle-node.ts`
- `packages/runtime-state/test/hosted-bundle.test.ts`

## Constraints

- Treat the returned patch as behavioral intent only; merge against live file state.
- Preserve unrelated dirty-tree edits.
- Keep the diff scoped to the returned security/privacy hardening.

## Plan

1. Review the returned patch and compare it against the live tree plus overlapping ledger lanes.
2. Land the smallest safe delta needed in hosted-web and runtime-state code/tests.
3. Run focused regressions for the touched suites.
4. Run repo-required verification and note any unrelated blockers.
5. Run the required completion review, then finish with a scoped commit.

## Verification

- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-contact-privacy.test.ts --no-coverage`
- Passed: `pnpm --dir packages/runtime-state exec vitest run test/hosted-bundle.test.ts --no-coverage`
- Passed: `pnpm typecheck`
- Passed with pre-existing warnings only: `pnpm --dir apps/web lint`
- Failed for a credibly unrelated pre-existing `apps/web` route-type issue after this plan existed: `pnpm test`
  - `apps/web/.next/types/validator.ts(197,39): error TS2307: Cannot find module '../../app/api/device-sync/oauth/[provider]/start/route.js' or its corresponding type declarations.`
- Failed for credibly unrelated pre-existing blockers: `pnpm test:coverage`
  - Same `apps/web/.next/types/validator.ts` route-type error as `pnpm test`
  - Existing `apps/cloudflare/test/user-runner.test.ts` failure: `reads hosted objects encrypted with previous key ids when a keyring is configured` expected `bucket.putCount()` to be `writesBeforeRead + 1`
- Passed: mandatory `task-finish-review` audit subagent; no findings in the scoped patch.

## Notes

- The original `cobuild-review-gpt thread wake` process did not survive long enough to auto-resume this session. The returned patch was downloaded manually from the supplied ChatGPT thread and is being landed through the normal repo workflow.
Status: completed
Updated: 2026-04-01
Completed: 2026-04-01
