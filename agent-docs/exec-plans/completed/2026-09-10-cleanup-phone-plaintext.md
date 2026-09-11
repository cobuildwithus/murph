# Prepare bounded deletion of legacy phone-call private records

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Provide a reviewed hosted operation to delete explicitly retired legacy phone-call records and their provider copies before removing plaintext compatibility.

## Success criteria

- Ops authorization and same-origin checks protect a bounded, default-dry-run operation.
- Eligibility and mailbox checks fail closed; provider deletion precedes exact row deletion.
- Existing readers and usage ledgers remain available; current call idempotency is preserved.
- Focused tests, Web typecheck, complexity diff, and owner documentation support a draft PR.

## Scope

- In scope: phone-owned deletion service, authenticated Ops route, notification/deletion race, owner runbook, focused proof.
- Out of scope: production operation, deployment, secrets, billing changes, active or current-session call deletion, reader/column removal in this PR.

## Constraints

- Reuse existing Ops, database, Retell, and member-lock owners.
- Never select or emit private JSON/ciphertext; durable evidence uses synthetic data.
- External provider work stays outside short database transactions.

## Risks and mitigations

1. A late callback could append work after deletion.
   Mitigation: serialize notification append and deletion through the existing member lock and recheck phone existence.
2. Provider deletion or row CAS may fail after earlier rows complete.
   Mitigation: preserve failing row and provider reference; report count-only partial progress and require a fresh dry run.
3. Old plaintext writers or accepted requests could replay.
   Mitigation: preserve the encrypted-writer rollback floor, require deployment/drain proof, and restrict selection to pre-session nonscheduled records.

## Tasks

1. Implement bounded hosted deletion and race protection.
2. Verify authorization, eligibility, provider failures, CAS, and interleavings.
3. Update current owner and open a draft PR.
4. Defined the separate reader-cut and held column-drop stages; their implementation belongs to dependent plans.

## Decisions

- The user selected deletion rather than encrypting retired plaintext records.
- The execution owner is an authenticated synchronous Web Ops route using current hosted Retell authority; no new workflow or credential path.
- This PR prepares the capability. Production deployment and execution remain separate reviewed operations.

## Verification

- Passed four focused Ops/phone suites: 63 tests, preserving crypto and account-deletion coverage.
- Passed 19 real PostgreSQL cases using a task-owned loopback database and synthetic schemas. Selection bounds, JSON null, retained billing, provider failure, CAS, partial retry, and member-lock races are covered.
- Repeated the PostgreSQL and notification suites after adding a nullable-fixture assertion: 41 tests passed.
- Passed `pnpm --dir apps/web typecheck:prepared` after the declared Prisma, Health Commons, device-syncd, and vault-usecases prerequisites.
- Passed `pnpm complexity:diff`: new service maximum 14; existing result-owner hotspots 34 and 22 unchanged. Their current channel/generation recovery branches remain active and are outside this retirement.
- Passed agent-doc drift, documentation gardening (zero issues), and `git diff --check`.
- Initial PostgreSQL proof used an application role without CREATE SCHEMA authority on the shared test database. A dedicated local database owned by that role resolved the test prerequisite without changing shared grants. One nullable test fixture assertion was fixed before the successful typecheck.
- No production operation, deployment, provider call, secret read, or private-data fixture was used.

Completed: 2026-09-10
