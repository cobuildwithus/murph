# Revoke orphaned Oura grants and run local webhook-admin upkeep

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Revoke Oura access when disconnects or post-token-exchange failures would otherwise orphan the upstream grant.
- Make standalone `packages/device-syncd` run the same best-effort Oura webhook subscription upkeep that the hosted connect flow already performs.

## Success criteria

- Oura disconnects call the provider revoke endpoint so local and hosted disconnects no longer default to local-only cleanup.
- Oura post-token-exchange failures that happen after an access token exists best-effort revoke that new grant before surfacing the error.
- Standalone `packages/device-syncd` runs webhook-admin upkeep after a connection is established, and failures stay best-effort with bounded logging.
- Focused `packages/device-syncd` tests cover the revoke and upkeep regressions, and the Oura README wording matches the actual upkeep behavior.
- Required verification, audits, and the scoped commit complete, or any unrelated blocker is documented precisely.

## Scope

- In scope:
  - `packages/device-syncd/src/{providers/oura.ts,public-ingress.ts,service.ts,types.ts}`
  - directly coupled `packages/device-syncd/test/{oura-provider,public-ingress,provider-descriptor-integration,service}.test.ts`
  - `packages/importers/src/device-providers/provider-descriptors.ts`
  - `packages/device-syncd/README.md`
  - `agent-docs/exec-plans/active/{2026-04-23-oura-revoke-and-local-webhook-upkeep.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - the already-claimed Oura webhook prune ownership fix in `packages/device-syncd/src/providers/oura-webhooks.ts`
  - the already-claimed hosted Oura browser privacy and webhook-dedupe changes outside the revoke-only seam in `packages/device-syncd/src/providers/oura.ts`
  - broader hosted webhook lifecycle redesign or generic unknown-account retry-policy changes

## Constraints

- Technical constraints:
  - Keep the Oura revoke path narrow and compatible with the existing `revokeAccess` provider contract used by local and hosted disconnect flows.
  - Do not widen into `oura-webhooks.ts` or other already-dirty hosted control-plane files.
  - Keep webhook-admin upkeep best-effort so connect succeeds even if provider-side upkeep fails.
- Product/process constraints:
  - This is trust-boundary and reliability work, so capture direct proof in addition to scripted verification.
  - Follow the plan-bearing repo workflow and required completion audits before handoff.

## Risks and mitigations

1. Risk: Adding public-ingress cleanup could swallow the original OAuth failure or mutate retry semantics.
   Mitigation: Run best-effort cleanup only after a connection result exists, preserve the original thrown error, and keep cleanup failures log-only.
2. Risk: Local webhook upkeep could overlap the already-claimed hosted Oura work or broaden into periodic subscription management.
   Mitigation: Mirror the existing hosted connect-time upkeep behavior only, keep the change in `service.ts`, and update the README to describe the connect-time upkeep truthfully.

## Tasks

1. Register the active plan/ledger scope and confirm the listed Oura findings against the current branch.
2. Implement Oura revoke support plus best-effort cleanup for post-token-exchange failures and post-exchange ingress failures.
3. Add standalone connect-time webhook-admin upkeep and focused regression coverage, then update the README wording.
4. Run scoped verification, capture direct proof, complete the required audit flow, and land a scoped commit.

## Decisions

- Reuse the existing `revokeAccess` provider seam for disconnects and construct a temporary connection-shaped account only for ingress cleanup after a connection result already exists.
- Mirror hosted connect-time webhook-admin upkeep inside standalone `DeviceSyncService` for Oura only instead of introducing a new periodic upkeep loop or widening the hook to every provider with webhook admin support.
- Keep the shared Oura provider descriptor in sync with the runtime by marking `supportsRemoteDisconnect: true` once the provider exposes `revokeAccess`.
- Describe `OURA_WEBHOOK_VERIFICATION_TOKEN` as enabling preflight handling plus connect-time subscription upkeep, not as a broad unconditional maintenance promise.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/providers/oura.ts packages/device-syncd/src/public-ingress.ts packages/device-syncd/src/service.ts packages/device-syncd/src/types.ts packages/device-syncd/test/oura-provider.test.ts packages/device-syncd/test/public-ingress.test.ts packages/device-syncd/test/provider-descriptor-integration.test.ts packages/device-syncd/test/service.test.ts packages/importers/src/device-providers/provider-descriptors.ts packages/device-syncd/README.md`
- Direct proof:
  - Run the focused Oura/provider and public-ingress regressions that prove a post-token-exchange failure revokes access best-effort and that standalone connect-time upkeep invokes webhook admin without blocking the connection.
- Expected outcomes:
  - Scoped `device-syncd` verification passes with the new revoke and upkeep regressions covered.
  - The README wording matches the implemented connect-time upkeep behavior.
- Final outcomes:
  - Focused Oura/provider, public-ingress, and Oura-only/non-Oura service upkeep proofs passed, including the missing-refresh-token revoke cleanup regression.
  - `pnpm --dir packages/device-syncd test:coverage` passed after the Oura-only follow-up.
  - `git diff --check` passed for the touched files.
  - `pnpm --dir packages/device-syncd typecheck` is still blocked by an unrelated pre-existing `packages/contracts/src/vault-families.ts` type error.
  - `pnpm typecheck` is still blocked by unrelated pre-existing `scripts/verify.ts` nullability errors.
  - `bash scripts/workspace-verify.sh test:diff ...` is still blocked by unrelated pre-existing `packages/assistantd` type/test-contract errors in the affected owner set.
Completed: 2026-04-23
