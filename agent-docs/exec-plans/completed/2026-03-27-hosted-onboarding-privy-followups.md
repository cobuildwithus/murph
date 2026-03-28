# Hosted onboarding Privy follow-ups in `apps/web`

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

- Close the remaining hosted onboarding security and cleanup gaps from the recent RevNet/billing refactor without widening the overall behavior change.
- Specifically: suspended members must not regain access through Privy verification, optional Privy cookie reads must stop breaking optional flows, and dead in-app RevNet confirmation waiting/config should be removed now that webhook activation no longer waits for confirmations.

## Success criteria

- `completeHostedPrivyVerification(...)` refuses suspended members before issuing invites or hosted sessions.
- `reconcileHostedPrivyIdentityOnMember(...)` preserves `HostedMemberStatus.suspended` instead of downgrading it during Privy re-verification.
- `getOptionalHostedPrivyIdentityFromCookies()` returns `null` for missing, stale, malformed, or missing-linked-account Privy cookies instead of throwing on optional paths.
- No live `apps/web` code depends on `waitForHostedRevnetPaymentConfirmation(...)` or `HOSTED_ONBOARDING_REVNET_WAIT_CONFIRMATIONS`.
- Focused hosted onboarding tests cover the changed behavior and remain green.

## Scope

- In scope:
  - hosted onboarding member/session verification logic
  - optional Privy cookie parsing behavior
  - hosted onboarding RevNet env/runtime cleanup inside `apps/web`
  - focused hosted onboarding tests needed to prove the new behavior
- Out of scope:
  - adding a new RevNet issuance repair worker or admin replay tool
  - changing dispute-policy semantics beyond preserving the current sticky suspension model
  - broad hosted onboarding architecture or Prisma schema changes

## Constraints

- Preserve the current model where `invoice.paid` activates access and RevNet submission failures do not block activation.
- Do not auto-retry or reinterpret `broadcast_unknown` issuance rows in this patch.
- Preserve adjacent dirty `apps/web` work; this lane is limited to the concrete follow-up issues called out in review.
- Keep the current public service/route interfaces stable.

## Risks and mitigations

1. Risk: tightening Privy verification could break valid returning-member flows.
   Mitigation: add direct service tests for active, suspended, and new-member verification branches.
2. Risk: making optional Privy lookup swallow too much could hide real required-auth failures.
   Mitigation: only the optional helper should downgrade known auth/linkage failures to `null`; required paths still use `requireHostedPrivyIdentityFromCookies()`.
3. Risk: removing RevNet confirmation config could miss a remaining hidden dependency.
   Mitigation: search all `apps/web` references first, remove only dead imports/paths, and update focused env/runtime tests.

## Tasks

1. Patch member/Privy services to preserve suspension and deny suspended re-auth before session creation.
2. Make optional cookie lookup return `null` for invalid or incomplete Privy identity state.
3. Remove dead confirmation waiter/config from `apps/web` RevNet/env/webhook code and align tests.
4. Run focused hosted onboarding tests, then required repo checks, then mandatory audit passes.

## Outcome

- Completed the suspended-member hardening in `apps/web` by preserving `HostedMemberStatus.suspended` during Privy reconciliation and rejecting suspended members before invite/session issuance.
- Completed the optional Privy cookie hardening so stale or incomplete optional Privy identity state now degrades to `null` instead of breaking optional billing paths.
- Removed the dead in-app RevNet confirmation waiter and its env/config surface from the hosted web app while preserving the current non-blocking invoice-paid activation and issuance-repair model.
- Focused hosted onboarding verification passed:
  - `pnpm --dir apps/web typecheck`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --maxWorkers 1 apps/web/test/hosted-onboarding-privy.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-onboarding-env.test.ts apps/web/test/hosted-onboarding-revnet.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- Required repo wrappers remain blocked by unrelated dirty-tree failures outside this lane:
  - `pnpm typecheck` fails in `packages/contracts/scripts/{generate-json-schema.ts,verify.ts}`
  - `pnpm test` and `pnpm test:coverage` fail in `packages/cli/src/assistant/service.ts`
- Mandatory audit subagent attempts were started, but the available spawned-agent paths in this environment did not yield a stable final review artifact before hanging; handoff should call out that audit-pass execution was attempted but not completed successfully.
Completed: 2026-03-28
