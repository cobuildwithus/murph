# Align WHOOP refresh-token rotation with the provider contract

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Enforce WHOOP's rotated refresh-token contract so refresh responses supply the next valid refresh token, and persist the provider-returned token bundle without silently reusing a stale token.

## Success criteria

- WHOOP refreshes fail closed when the refresh response omits the replacement `refresh_token`.
- Hosted token-bundle persistence stores the provider-returned refresh token as-is instead of falling back to the previous stored token.
- Focused `packages/device-syncd` and `apps/web` tests cover the provider and hosted persistence regression paths.
- Required verification, completion audits, and the scoped commit complete or any unrelated blocker is documented.

## Scope

- In scope:
  - `packages/device-syncd/src/providers/whoop.ts`
  - `packages/device-syncd/test/whoop-provider.test.ts`
  - `apps/web/src/lib/device-sync/agent-session-service.ts`
  - `apps/web/test/agent-session-service.test.ts`
  - `agent-docs/exec-plans/active/{2026-04-23-whoop-refresh-token-rotation.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - changing shared OAuth refresh semantics for providers other than WHOOP
  - broader hosted device-sync runtime-authority or Prisma persistence redesigns
  - unrelated wearable-provider token rotation behavior unless this fix proves insufficient

## Constraints

- Technical constraints:
  - Keep provider-specific refresh-token semantics owned by the provider implementation rather than adding WHOOP-only branching to hosted persistence.
  - Preserve existing WHOOP authorization-code exchange requirements and existing non-WHOOP refresh behavior.
  - Work safely in the current dirty tree without widening into unrelated hosted auth/billing/runtime edits.
- Product/process constraints:
  - Treat this as a provider-contract and token-authority fix under an external auth boundary.
  - Use the plan-bearing repo workflow, including required completion audits and direct proof.

## Risks and mitigations

1. Risk: A generic hosted persistence change could regress providers that intentionally retain the prior refresh token.
   Mitigation: Make WHOOP return the authoritative rotated token itself, then have hosted persistence trust the provider contract generically.
2. Risk: Tests could still mask the bug through local harness fallback behavior even after production code changes.
   Mitigation: Update both WHOOP provider coverage and the hosted agent-session harness/assertions so `null` refresh tokens stay observable.

## Tasks

1. Register the plan/ledger scope and confirm the provider and hosted persistence seams involved.
2. Make WHOOP refresh fail closed on missing rotated refresh tokens and remove the hosted stale-token fallback.
3. Update focused provider and hosted tests to cover the contract-aligned behavior.
4. Run scoped verification, direct proof, required completion audits, and the scoped commit flow.

## Decisions

- WHOOP refresh-token rotation is enforced at the provider boundary: if WHOOP does not return the next refresh token, treat the refresh as invalid instead of persisting the previous token.
- Hosted agent-session persistence should trust the provider-returned token bundle rather than applying a second provider-agnostic refresh-token fallback.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/providers/whoop.ts packages/device-syncd/test/whoop-provider.test.ts apps/web/src/lib/device-sync/agent-session-service.ts apps/web/test/agent-session-service.test.ts`
- Direct proof:
  - Run focused WHOOP/provider and hosted agent-session tests that prove a missing WHOOP refresh-token replacement is not silently persisted.
- Expected outcomes:
  - Typecheck and the scoped diff-aware verification pass for the touched device-syncd and hosted device-sync paths.
  - The direct-proof tests show WHOOP refresh rotation is either persisted from the response or rejected without stale-token fallback.
Completed: 2026-04-23
