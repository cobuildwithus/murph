# Drop the retired Family capacity column after drain

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Contract the redundant Family billed total only after all database consumers have moved to the per-tier projection.

## Success criteria

- One idempotent postdeploy DROP removes the aggregate and its dependent CHECK while preserving checkout intent, tier rows, and billing state.
- Local transactional PostgreSQL proof validates first application and replay.
- The draft PR is explicitly held until its writer-removal dependency is deployed and old ordinary functions plus pinned Stripe Workflows drain.

## Scope

- In scope: contract SQL and the existing Family rollout owner documentation.
- Out of scope: production mutation, earlier writer/reader release, new deployment infrastructure, removal of billing tables or history.

## Constraints

- Automatic contract execution is why this change must remain a separate release.
- No pre-writer-removal deployment may execute or be an allowed rollback target when contraction applies.
- Use the existing short lock/statement limits and migration ledger.

## Risks and mitigations

1. Old Prisma clients select the removed field; old Stripe Workflows remain pinned to their originating deployment. Hold merge until ordinary and durable drain proof closes, then recheck the exact production alias.
2. DDL can contend with live traffic. Keep transaction-local short timeouts and retry through the existing migration owner.

## Tasks

1. Prepare the isolated contraction SQL.
2. Prove idempotence and retained state using temporary PostgreSQL tables, then advance this branch onto the verified writer-removal head.
3. Close the plan and open a held dependent draft PR.

## Decisions

- No new compatibility flags or deployment gate implementation.
- An older rollback requires database re-expansion or a forward fix.

## Verification

- Passed: local PostgreSQL temporary-table proof applies the real migration twice, asserts column absence and unchanged checkout, billing phase and per-tier capacity, then rolls back all fixtures.
- Passed: the writer-removal code's 20 Stripe entitlement and usage-reset PostgreSQL tests before and after this real migration applied twice to the owned loopback database initialized from the reader-release schema.
- Passed: advanced onto the verified writer-removal commit; final SQL/diff and owner-document readback, privacy and whitespace checks.
- Typecheck and complexity metric do not apply to SQL/Markdown-only changes.
Completed: 2026-09-10
