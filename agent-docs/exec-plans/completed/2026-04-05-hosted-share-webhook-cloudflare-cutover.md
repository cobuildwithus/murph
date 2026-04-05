# Hosted share and webhook Cloudflare cutover

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Remove the remaining decryptable hosted share and webhook side-effect payload ownership from `apps/web` by moving any still-required secret-bearing payload bodies into Cloudflare-owned encrypted storage and leaving Postgres with refs or sparse metadata only.

## Success criteria

- `hosted_share_link` no longer stores decryptable share-pack ciphertext under the hosted onboarding web key.
- Hosted share acceptance still renders previews, queues execution, and finalizes imports without reading share packs from Postgres.
- Hosted webhook receipts no longer persist encrypted Linq side-effect payload blobs in Postgres; either the payload is deleted entirely or the remaining retry payload lives in Cloudflare-owned encrypted storage.
- Focused hosted-share and webhook tests pass, plus the required repo verification commands for `apps/web`.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-share/**`
  - `apps/web/src/lib/hosted-onboarding/webhook-*`
  - `apps/web/src/lib/hosted-execution/{control,hydration}.ts` as needed
  - `apps/cloudflare/src/**` for narrow share/webhook payload storage routes or stores
  - `packages/hosted-execution/src/**` for narrow control-client/contracts/route support
  - `apps/web/prisma/schema.prisma`, migrations, and focused tests
- Out of scope:
  - Device-sync escrow or token storage
  - Hosted email raw-body storage
  - New auth, OIDC, passkey, Vault/OpenBao, or TEE behavior
  - Compatibility shims for removed hosted onboarding encryption payload shapes

## Constraints

- Technical constraints:
  - Preserve unrelated dirty-tree edits already present in the live branch.
  - Prefer deletion over re-homing when sparse retained state is already enough.
  - Keep Cloudflare ownership narrow: reuse existing signed control-plane and encrypted R2 patterns where possible.
- Product/process constraints:
  - Treat the prompt as intent, not overwrite authority.
  - Stay within this worker lane only.
  - Run the required completion audit pass before handoff.

## Risks and mitigations

1. Risk: share acceptance can regress if the outbox hydration path cannot rehydrate a Cloudflare-backed share pack.
   Mitigation: update share creation, share preview reads, and execution hydration together with focused integration tests.
2. Risk: webhook retry semantics can break if Linq invite/quota reply payloads are deleted without a durable replacement.
   Mitigation: only delete the persisted payload when the remaining sparse state can still deterministically rebuild the outbound request; otherwise move the payload behind Cloudflare before removing the web-key ciphertext.
3. Risk: control-plane route additions can widen trust boundaries.
   Mitigation: keep routes signed server-to-server only, scoped to the minimum read/write/delete operations, and reuse the existing control client/env path.

## Tasks

1. Register the live lane and inspect current hosted-share plus webhook receipt persistence.
2. Move hosted share pack storage to Cloudflare-owned encrypted storage and keep only refs/sparse preview metadata in Postgres.
3. Cut hosted execution hydration over to the new share-pack read path.
4. Remove webhook receipt Linq side-effect ciphertext from Postgres by deletion or Cloudflare re-homing.
5. Update Prisma, tests, verification, audit, and scoped commit flow.

## Decisions

- The existing webhook dispatch side effects are already sparse reference payloads and do not need another storage migration in this lane.
- The remaining encrypted webhook retention to audit is the Linq message-send side-effect payload in hosted webhook receipts.
- Legacy Linq webhook receipts are cut over with a hard-delete migration instead of a backward-compatible reader.
- Hosted share packs keep a lifecycle-expiry backstop in R2 rather than being deleted immediately on finalize, because consumed-share UI still rehydrates preview data from the pack.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
  - `pnpm --dir apps/web lint`
  - Focused `vitest` files as needed during iteration
- Expected outcomes:
  - Hosted share creation/acceptance and hosted webhook receipt retry paths pass with Postgres holding only refs or sparse receipt state for this lane.

## Outcome

- Implemented Cloudflare-backed share-pack storage and removed `hosted_share_link.encrypted_payload` plus onboarding env-key usage in `apps/web`.
- Replaced Linq webhook encrypted payload persistence with sparse retry metadata and added a hard-cut migration that deletes pre-cutover Linq receipts and matching outbox rows.
- Added an R2 lifecycle rule for transient share packs and moved share acceptance preview reads before durable state mutation.

## Final verification

- Passed focused `apps/web` webhook tests for receipt transitions, idempotency, and Linq dispatch.
- Passed focused `apps/web` hosted share and hydration tests, including the missing-pack preclaim failure case.
- Passed focused `packages/hosted-execution` control-client tests and focused `apps/cloudflare` signed share-route tests.
- Passed `pnpm --dir apps/cloudflare typecheck`.
- Passed direct `pnpm exec tsc -p tsconfig.json --pretty false` in `apps/web`.
- Passed `pnpm --dir apps/web lint` with pre-existing warnings only.
- `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` remain blocked in this sandbox by `tsx` IPC pipe `EPERM`; `pnpm test:coverage` also hits Wrangler/Miniflare `EPERM` log/listen restrictions.
Completed: 2026-04-05
