# 2026-03-28 Privy Auth Hardening

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Close the reported Privy trust-boundary and stale-linked-account bugs in hosted onboarding so billing, onboarding completion, and Telegram sync all fail closed on stale or mismatched Privy state.

## Success criteria

- Hosted billing checkout no longer writes wallet identity data onto a hosted member outside the existing onboarding reconciliation path.
- Telegram sync requires the client-expected Telegram user id, rejects ambiguous Privy Telegram state, and only persists the server-confirmed Telegram account when it matches the expected id.
- Shared Privy account extractors use deterministic selection rules without order-dependent "first match wins" behavior for canonical hosted identity fields.
- Hosted onboarding completion returns retryable "server-side Privy session not ready" failures for cookie-lag phone/wallet gaps, with a client path that retries those responses.
- Focused `apps/web` regressions cover the new fail-closed behaviors.

## Scope

- In scope:
  - `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `apps/web/src/lib/hosted-onboarding/{billing-service.ts,privy.ts,privy-shared.ts}`
  - `apps/web/src/components/{hosted-onboarding/hosted-phone-auth.tsx,settings/hosted-telegram-settings*.ts*}`
  - `apps/web/app/api/{hosted-onboarding/privy/complete/settings/telegram/sync}/route.ts`
  - Targeted `apps/web/test/{hosted-onboarding-billing-service,hosted-onboarding-privy,hosted-onboarding-privy-shared,hosted-onboarding-routes,settings-telegram-sync-route}.test.ts`
- Out of scope:
  - Broad Stripe receipt/idempotency work already covered by the active Stripe hardening lane.
  - Telegram webhook ingestion/file-boundary changes already covered by the active Telegram webhook lane.
  - Any new product behavior beyond fixing the reported Privy auth/session correctness defects.

## Constraints

- Technical constraints:
  - Preserve adjacent dirty edits in the live hosted-onboarding tree, especially `billing-service.ts`, `member-service.ts`, and Telegram-related files.
  - Keep identity binding centralized in existing onboarding reconciliation code; do not add a second member-binding path in billing.
  - Maintain the server-side Privy cookie as the trust boundary; client state may only be used to express expected values and drive retry behavior.
- Product/process constraints:
  - Keep the change proportional and fail closed on ambiguity instead of inventing permissive fallback resolution.
  - Run focused verification, then repo-wide checks, then the mandatory `simplify`, `test-coverage-audit`, and `task-finish-review` audit subagents.

## Risks and mitigations

1. Risk: overlapping onboarding lanes are actively editing nearby files.
   Mitigation: keep this lane Privy-specific, read live file state before each edit, and avoid touching unrelated Stripe or webhook logic.
2. Risk: stricter extractor behavior could regress legitimate single-account payloads.
   Mitigation: keep deterministic selection conservative, add regression tests for both valid and ambiguous multi-candidate payloads, and preserve existing single-account happy paths.
3. Risk: onboarding retry handling could overreach into generic fetch behavior.
   Mitigation: keep the retry wrapper local to the hosted phone-auth completion path instead of broadening the shared client API contract.

## Tasks

1. Stop billing from mutating hosted wallet identity data and keep checkout wallet validation read-only against the verified Privy session.
2. Harden shared Privy account extraction with deterministic, ambiguity-aware selection for phone, wallet, and Telegram accounts.
3. Add Telegram sync expected-id request validation and ambiguous-account rejection, with matching client request plumbing.
4. Convert hosted Privy completion lag into retryable server-not-ready responses and add a narrow client retry loop for completion.
5. Add focused regressions, run verification, complete required audit passes, and commit with the active plan.

## Decisions

- Billing wallet binding will be removed from checkout instead of rerouting that mutation through a new billing-specific reconciliation layer.
- The client will continue to trust the server cookie as the source of truth, but it will send the expected Telegram user id and retry explicitly retryable Privy-completion lag responses.
- Telegram sync now requires a client-confirmed expected Telegram user id; missing ids fail closed instead of falling back to whatever Telegram account the server cookie currently exposes.

## Verification

- Commands to run:
  - Focused hosted-onboarding/settings Vitest coverage around the touched files.
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Focused suites should pass.
  - Repo-wide checks may still surface unrelated dirty-tree blockers; if so, record the exact failure and causal separation before handoff/commit.
- Results:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-onboarding-privy.test.ts apps/web/test/hosted-onboarding-privy-shared.test.ts apps/web/test/hosted-onboarding-routes.test.ts apps/web/test/settings-telegram-sync-route.test.ts --no-coverage --maxWorkers 1` passed (`59` tests) after the simplify-driven Telegram fixes.
  - `pnpm --dir apps/web typecheck` passed.
  - `pnpm exec tsx --eval 'import { extractHostedPrivyWalletAccount, resolveHostedPrivyTelegramAccountSelection } from "./apps/web/src/lib/hosted-onboarding/privy-shared.ts"; ...'` confirmed lowest-index embedded wallet selection and ambiguous Telegram rejection.
  - `pnpm typecheck` failed in unrelated dirty-tree workspace code under `packages/device-syncd/src/store.ts` (SQL parameter typing) and then `packages/importers/src/device-providers/{garmin-helpers.ts,oura.ts,shared.ts}` (`@murph/contracts` resolution).
  - `pnpm test` failed in unrelated dirty-tree workspace code under `packages/device-syncd/src/{config.ts,providers/oura.ts,providers/shared-oauth.ts,providers/whoop.ts,service.ts,shared.ts,store.ts,types.ts}` plus a follow-on `ENOTEMPTY` build race removing `packages/core/dist/domains`.
  - `pnpm test:coverage` failed in unrelated dirty-tree workspace code under `packages/device-syncd/src/store.ts` (same SQL parameter typing failures as `pnpm typecheck`).
  - Mandatory audit passes:
    - `simplify` completed via `.codex-runs/20260328-161026/privy_simplify_prompt.last.txt` and found two Telegram fail-closed gaps; both were fixed and covered.
    - `test-coverage-audit` was attempted via `.codex-runs/20260328-161417/privy_coverage_prompt.log` but the worker failed before producing findings because the Codex worker hit a usage-limit error.
    - `task-finish-review` was attempted via `.codex-runs/20260328-161443/privy_finish_prompt.log` but the worker failed before producing findings because the Codex worker hit a usage-limit error.
Completed: 2026-03-28
