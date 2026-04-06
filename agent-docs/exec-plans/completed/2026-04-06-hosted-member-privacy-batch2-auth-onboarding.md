# Hosted Member Privacy Batch 2 Auth Onboarding

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Cut hosted auth and onboarding over to the additive identity-side storage introduced in Batch 1, while keeping member entitlement, routing, and Stripe references on their current owners in this lane.

## Success criteria

- `request-auth.ts` resolves members through `HostedMemberIdentity`-backed helpers rather than relying on the wide `HostedMember` identity fields directly.
- Privy verification completion and invite reconciliation use `privyUserId` and phone lookup data through the new identity helper surface.
- Non-Revnet invite/auth stage logic no longer requires both `privyUserId` and `walletAddress` to count as identity-ready.
- Focused hosted-onboarding tests cover the new auth/onboarding behavior and pass.
- Required repo verification for `apps/web` changes passes, or any unrelated blocker is explicitly documented with evidence.

## Scope

- In scope:
- `apps/web/src/lib/hosted-onboarding/request-auth.ts`
- `apps/web/src/lib/hosted-onboarding/authentication-service.ts`
- `apps/web/src/lib/hosted-onboarding/invite-service.ts`
- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`
- `apps/web/src/lib/hosted-onboarding/member-service.ts`
- Focused hosted-onboarding tests under `apps/web/test/**`
- Out of scope:
- Linq and Telegram routing cutover
- Stripe billing-ref cutover
- Email identity persistence changes
- Removal of legacy `HostedMember` identity columns or `HostedSession`

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree edits.
- Assume the Batch 1 additive schema/helper layer is the foundation; do not redesign it.
- Keep email identity out of Postgres.
- Keep wallet logic conditional on actual Revnet enablement.
- Product/process constraints:
- Preserve existing user-facing errors unless a clear simplification stays behaviorally aligned.
- Follow the repo high-risk workflow: coordination ledger, execution plan, required audit pass, verification, and scoped commit helper.

## Risks and mitigations

1. Risk: Batch 1 left live dirty edits in the same hosted-onboarding files.
   Mitigation: Read current file state first, edit narrowly, and avoid reverting adjacent work.
2. Risk: Auth-stage heuristics may accidentally change Revnet-enabled behavior while fixing the non-Revnet path.
   Mitigation: Keep wallet checks gated behind the existing Revnet enablement seam and add focused tests for both sides.
3. Risk: Identity lookups may drift between the new helper layer and legacy fallback behavior.
   Mitigation: Reuse the existing hosted-member-store helpers and verify request-auth plus Privy completion paths together.

## Tasks

1. Register the active lane in `COORDINATION_LEDGER.md` and keep this plan current while work is active.
2. Review the Batch 1 helper/store seams and current hosted auth/onboarding code to identify direct wide-row identity coupling.
3. Refactor request auth and Privy completion/reconciliation to read identity through the new helper surface.
4. Fix invite/auth stage evaluation so identity readiness no longer depends on wallet presence when Revnet is disabled.
5. Update focused tests, run required verification, capture direct scenario proof, and complete the required audit/commit workflow.

## Decisions

- Keep this lane limited to auth/onboarding identity resolution; routing and billing ownership stay unchanged here.
- Prefer reusing `hosted-member-store` helper reads over adding a second identity abstraction.
- Strengthen proof with focused hosted-web tests plus one explicit invite query-shape check rather than widening into Prisma-backed integration scaffolding in this lane.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Focused `apps/web` Vitest commands as needed during iteration
- Expected outcomes:
- Repo-required `apps/web` verification should pass because this task changes hosted-web runtime behavior in a high-risk auth surface.
- Outcomes:
- `pnpm --dir apps/web lint` passed with warnings only; none were introduced by the touched auth/onboarding files.
- `pnpm typecheck` failed in the `apps/web` wrapper because `tsx` could not create its IPC pipe in this sandbox (`listen EPERM .../tsx-501/...pipe`) before TypeScript diagnostics ran.
- `pnpm test:coverage` failed for the same sandbox-level `tsx` IPC reason during a wrapper step, before code-level verification of this lane.
- Direct hosted-web fallbacks passed:
- `pnpm --dir apps/web exec prisma generate`
- `pnpm exec tsc -p apps/web/tsconfig.json --pretty false`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-onboarding-integrations --project hosted-web-onboarding-core apps/web/test/hosted-onboarding-request-auth.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-privy-invite-status.test.ts --no-coverage`
Completed: 2026-04-06
