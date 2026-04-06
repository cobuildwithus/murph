# Hard-cut hosted member raw identifiers into Cloudflare private state

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Hard-cut the remaining recoverable hosted-member raw identifiers out of Postgres and move them into Cloudflare-owned encrypted member-private-state storage, while keeping only blind lookup keys in Postgres for equality lookups and routing.

## Success criteria

- `HostedMemberIdentity`, `HostedMemberRouting`, and `HostedMemberBillingRef` store blind lookup keys instead of raw Privy, wallet, Linq, and Stripe identifiers.
- Hosted web reads and writes raw member identifiers only through the hosted execution member-private-state control seam while preserving current aggregate call shapes.
- Cloudflare exposes encrypted member-private-state read/write/delete routes backed by user-bound hosted crypto.
- Regression coverage exists for the private-state contract and lookup-key helpers.
- Required repo verification and direct scenario proof complete, then the task lands through the required completion review and scoped commit flow.

## Scope

- In scope:
  - `packages/hosted-execution` member-private-state contract, routes, and control client methods
  - `apps/cloudflare` encrypted member-private-state storage and worker internal route handling
  - `apps/web` Prisma schema/migration, hosted-member store cutover, and hosted execution control helpers
  - focused hosted-web regression tests for lookup helpers and private-state behavior
- Out of scope:
  - rewriting `HostedBillingCheckout` or `HostedStripeEvent` ledgers
  - redesigning the broader hosted-member privacy batches that already landed
  - unrelated Cloudflare owner-surface refactors outside the minimum route wiring needed for this cutover

## Constraints

- Technical constraints:
  - Treat the supplied patch as intent only and port it onto the current tree without overwriting adjacent hosted changes.
  - Persisting non-null raw member identifiers now depends on hosted execution control plus managed user crypto being configured; fail closed when that boundary is unavailable.
  - The migration is intentionally destructive for non-greenfield data and assumes raw identifiers are backfilled into member-private-state storage before deployment.
- Product/process constraints:
  - Preserve current hosted-member aggregate shapes for existing callers.
  - Preserve unrelated worktree state and comply with the repo coordination ledger, verification, audit, and commit requirements.

## Risks and mitigations

1. Risk: Raw identifiers could still leak through Postgres reads or writes after the cutover.
   Mitigation: Move all recoverable values behind one typed private-state helper and update aggregate mappers plus lookup helpers together.
2. Risk: Hosted execution control or crypto setup gaps could cause silent partial writes.
   Mitigation: Fail closed when persistent private state is required and capture direct scenario proof for the new control path.
3. Risk: The patch was built against an earlier snapshot and may conflict with current hosted work.
   Mitigation: Reconcile drift file by file, keep the change narrow, and avoid unrelated refactors.

## Tasks

1. Update the coordination ledger and keep this execution plan current.
2. Port the shared `HostedMemberPrivateState` contract and hosted execution route/client helpers.
3. Add Cloudflare encrypted storage and internal worker route handling for member private state.
4. Cut Prisma and hosted-member store lookups/writes over to blind lookup keys plus Cloudflare private state.
5. Add focused regression tests, run required verification and a direct scenario proof, then complete the required final review and scoped commit flow.

## Decisions

- Use a Cloudflare-owned encrypted object per member as the recoverable raw-identifier store, keyed by the member id and protected by the existing hosted user crypto context.
- Keep Postgres lookup capability only through blind lookup keys for fields that still need equality lookups or routing.
- Preserve current aggregate return shapes by hydrating raw values from private state at read time instead of exposing a new caller contract in this cutover.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:coverage`
  - focused direct scenario proof for hosted member private-state read/write/delete behavior
- Expected outcomes:
  - Required repo verification passes, or any unrelated blockers are explicitly identified and defended per repo policy.
  - Direct scenario evidence proves the member-private-state contract behaves correctly at the hosted execution boundary.
- Results:
  - `pnpm --dir packages/hosted-execution typecheck` -> passed
  - `pnpm --dir apps/cloudflare typecheck` -> passed
  - `pnpm --dir apps/web typecheck` -> passed
  - `pnpm typecheck` -> passed
  - `pnpm exec vitest run apps/web/test/contact-privacy-member-lookups.test.ts apps/web/test/hosted-member-private-state.test.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-onboarding-member-service.test.ts --config apps/web/vitest.workspace.ts --no-coverage` -> passed
  - `pnpm --dir packages/hosted-execution exec vitest run test/member-private-state.test.ts --config vitest.config.ts --no-coverage` -> passed
  - `pnpm exec vitest run apps/cloudflare/test/member-private-state-store.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage` -> passed
  - `pnpm exec vitest run apps/cloudflare/test/index.test.ts apps/cloudflare/test/member-private-state-store.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage` -> passed
  - `pnpm test:coverage` -> failed for a pre-existing unrelated `packages/cli` package-shape guard (`package.json must not keep a runtime dependency on @murphai/gateway-core after the hard cut.`); no files in that package or guard path are touched by this cutover
- Direct scenario proof:
  - Hosted execution contract/client test proves authorized `GET` / `PUT` / `DELETE` member-private-state round-trips and route/user mismatch rejection.
  - Cloudflare worker route test proves signed `GET` / `PUT` / `DELETE` member-private-state handling, route/member mismatch rejection, and missing-crypto read/delete behavior.
  - Cloudflare store test proves user-root-key isolation and authoritative object-key deletion behavior.
  - Hosted web tests prove lookup-key derivation and aggregate hydration behavior after the Postgres raw-identifier cutover.
Completed: 2026-04-07
