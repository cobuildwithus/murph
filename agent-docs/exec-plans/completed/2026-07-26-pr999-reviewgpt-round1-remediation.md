# PR 999 ReviewGPT round 1 remediation

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Make the final SDK sign-in authority check atomic at the store boundary so a
  concurrent disconnect cannot be hidden by a stale, asynchronously decrypted
  connection snapshot.

## Success criteria

- Both SDK token-mint paths finish with one exact current-row authority
  predicate after all asynchronous snapshot reconstruction.
- The predicate requires the same account, owner, provider, external identity,
  active status, and source-confirmed setup phase.
- A disconnect after the row snapshot but before token return produces
  `SDK_SIGN_IN_RECONNECT_REQUIRED`.
- Focused tests, canonical verification, ReviewGPT remediation review, and
  required PR checks pass.

## Scope

- In scope: the public-ingress store contract, hosted Prisma implementation,
  local adapter, and focused stale-snapshot coverage.
- Out of scope: provider token revocation, connection-state redesign, schema
  changes, UI, and unrelated device-sync flows.

## Constraints

- Keep the authority predicate as the last awaited operation before return.
- Do not decrypt provider identifiers inside the final hosted predicate.
- Add no persisted state or dependency.
- Preserve local single-user adapter behavior and existing provider lifecycle
  ownership.

## Risks and mitigations

1. Risk: the hosted predicate could compare a differently normalized identity.
   Mitigation: reuse the canonical provider blind-index derivation used by
   connection persistence.
2. Risk: an adapter could silently omit part of the lifecycle check.
   Mitigation: make the predicate required by the shared store contract and
   cover hosted query shape plus in-memory lifecycle behavior.
3. Risk: a later await could reopen the race.
   Mitigation: keep the predicate as the final await and perform only
   synchronous validation afterward.

## Tasks

1. Add the exact stale-snapshot regression and hosted no-decryption query-shape
   proof.
2. Implement the smallest required store-owned authority predicate.
3. Run focused tests, package typechecks, canonical verification, and product
   review.
4. Push the remediation head, update the existing draft PR, and run final
   ReviewGPT round 2 plus CI.
5. Close this plan with the final scoped remediation commit and leave the PR
   unmerged.

## Decisions

- Accept the final-review finding because the hosted read reconstructs the
  selected row across an asynchronous decrypt before the previous owner check.
- Keep row currency in the store that owns persistence semantics instead of
  adding locks across provider network I/O.

## Verification

- Focused shared-ingress proof:
  `pnpm exec vitest run packages/device-syncd/test/public-ingress.test.ts
  --no-coverage` passed all 67 tests, including create and resume races that
  disconnect after the post-mint account snapshot.
- Focused hosted-store proof:
  `pnpm exec vitest run --config apps/web/vitest.config.ts
  apps/web/test/prisma-store-oauth-connection.test.ts --no-coverage` passed all
  35 tests, including the exact one-query, no-decryption predicate shape.
- `pnpm --dir packages/device-syncd typecheck`: passed.
- `pnpm --dir apps/web typecheck`: passed after generating the worktree's
  expected Health Commons and Prisma build artifacts.
- `pnpm --dir packages/device-syncd test`: passed, 44 files and 865 tests.
- Canonical `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff ...` passed the
  affected device-sync and hosted-store checks, then failed outside this diff
  in `@murphai/vault-usecases` because its generated Health Commons
  `biomarkers.json` artifact was absent in the isolated Testbox.
- Product-experience review: `NO FINDINGS`; create and resume share the final
  authority check, explicit disconnect remains final, visible reconnect remains
  valid, passive resume fails closed, and the correction adds no user
  interaction, persisted state, or dependency.
- Parent final review: no findings; the required store contract makes adapter
  coverage explicit, the hosted implementation checks identity, owner,
  provider, and lifecycle in one current-row query, and no asynchronous work
  follows that authority predicate.
- Exact-head ReviewGPT round 2 and PR CI: pending.
Completed: 2026-07-26
