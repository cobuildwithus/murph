# Stop dual-writing the legacy Family capacity total

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Remove the redundant aggregate billing writer and Prisma field after the per-tier reader release is established, preserving Stripe reconciliation atomicity and all checkout/identity authority.

## Success criteria

- Only per-tier rows persist capacity; no runtime query references the aggregate column.
- Existing schema remains backward compatible physically until later contraction.
- Focused billing tests, Web typecheck, schema validation and complexity guard pass.
- Draft PR remains held until the prior reader release is deployed and old readers drain.

## Scope

- In scope: aggregate writer, Prisma field, obsolete test fixture fields, owner contract.
- Out of scope: physical column DROP, production mutation, checkout seat intent, subscription-item identity, paid-capacity transaction ordering.

## Constraints

- Depend on the per-tier reader release; no automatic column-drop migration in this release.
- Preserve prior reader floor for rollback. Pre-removal Stripe Workflows can still dual-write the retained physical column until they settle.
- No private production evidence or identifiers in artifacts.

## Risks and mitigations

1. Old growth readers can omit newly paid groups when their aggregate is null. Deploy only after the reader release is current and prior readers drain.
2. Old generated Prisma clients and pinned Stripe Workflows still use the physical field. Retain the column; contract only after all those executions settle.

## Tasks

1. Remove aggregate writes, normalization and Prisma field; update tests to explicit tier capacity.
2. Verify checkout intent, Stripe freshness, terminal and positive subscription reconciliation, and mixed-tier limits.
3. Close plan, commit and open the dependent held draft PR.

## Decisions

- Keep the physical nullable column until a third independently gated release.
- Internal implementation cleanup; no member-facing changelog change.

## Verification

- Passed: frozen dependency install, Prisma client generation and schema validation.
- Passed: 564 tests in nine focused Family, growth, allowance, Telegram and billing-support files.
- Passed: 20 Stripe entitlement and usage-reset PostgreSQL tests with the preceding reader schema, preserving the physical aggregate column.
- Passed: Web prepared typecheck after generated inputs and the new Prisma client were prepared.
- Passed: complexity:diff against the preceding reader head; one authored source file, unchanged hotspot debt and maximum complexity. Existing payment, identity and recovery branches remain current authority.
- Passed: the same 20 PostgreSQL tests after applying and replaying the later contract SQL in the owned loopback test database.
- Passed: full source/fixture and owner-document readback, privacy and whitespace checks.
- Production rollout and durable drain remain separate release gates; this task performs no production mutation.
Completed: 2026-09-10
