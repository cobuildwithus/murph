# Simplify hosted external-effect state ownership

Status: active
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Make computer handoff publication one database transition and delete unused pause-message state without weakening capability, generation or provider-acceptance authority.

## Success criteria

- Handoff creation, run binding and displaced-link expiration commit together.
- A losing transition leaves no new handoff or changed run.
- Dead awaiting-message plumbing is removed; physical column deletion waits for old deployment drain.
- Every audit retirement has an evidence-based disposition.
- Focused computer/managed-login tests and hosted Web typecheck pass.

## Scope and constraints

Computer-use service/store, affected tests, logical Prisma schema and owning architecture documentation. Keep provider operations and capability preparation outside short database-only transactions. Preserve stale checkpoint recovery and exact conditional-write guards. No production mutation or new generic action abstraction.

## Tasks

1. Replace separate create/bind/compensate sequences at the existing store owner.
2. Remove unused awaitingMessage readers, arguments, mappings and reset writes.
3. Investigate physical-note legacy ambiguity, approval dual hashing and passkey rollout gates.
4. Run focused tests and typecheck, review changes, and prepare a draft PR for the parent completion owner.

## Decisions and retirement evidence

- Physical-note legacy retirement is deferred: bounded read-only aggregate evidence confirms unresolved historical failure state remains. Existing provider reconciliation must settle it before removing the legacy acceptance path; do not manufacture billing evidence.
- Approval dual hashing is removed after bounded read-only drain evidence ruled out retained null-channel approval candidates. The modern serializer has been the sole writer since the historical compatibility reader was introduced. Retain exact action hash, generation and consumer checks; the current production alias was independently verified to include the modern writer.
- Passkey enrollment flag remains: the current security owner also uses it to pause enrollment and recovery at admission and commit, independently of existing-key verification (docs/hosted-auth-migration.md). Deleting it would remove current product/security behavior, not just a finished migration branch.
- Remove awaitingMessage from the logical client schema now, leaving the nullable physical column in place for old deployed readers. The prepared post-drain contract migration owns physical removal through the existing exact-alias and old-function-drain lane; no production mutation was run.

## Verification

- Focused Vitest execution passed 235 tests: existing computer and managed-login journeys, ten real PostgreSQL publication/admission/column-cleanup cases, and nine real PostgreSQL approval-generation cases.
- `pnpm --dir apps/web typecheck` and final `typecheck:prepared` passed.
- `pnpm complexity:diff` passed: computer service complexity debt decreased from 67 to 64; store and approval debt remain zero.
- Focused oxlint, `git diff --check`, and `pnpm docs:drift` passed.
- Local database setup used the current Prisma schema in an isolated loopback test database. Column cleanup executed its exact SQL twice and preserved current-client reads.
- No prompt, tool schema, availability or assistant reply policy changed; live-model proof is not applicable to these database-only ownership changes.
- Product journeys retain current link presentation, resume authority, sensitive-action generations and replay. Database proof covers losing requests, insertion rollback, competing winners and suspension; no visual UI changed.
- Parent completion owner retains final review, ReviewGPT, exact-head CI, plan closure and release. No production mutation or message was sent.

