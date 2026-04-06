# Inbox canonical intake cutover

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Make the inbox-capture ledger plus raw inbox evidence the only canonical intake fact for inbound captures.

## Success criteria

- New inbox captures append canonical raw evidence plus exactly one canonical structured intake record under `ledger/inbox-captures/**`.
- Intake repair/idempotency paths backfill only the inbox-capture ledger entry and stop manufacturing peer event/audit rows for the same inbound item.
- Any remaining event or audit records for inbox captures are treated as derived or compatibility-only surfaces, not required canonical intake evidence.
- Durable docs and tests reflect the simplified intake contract.

## Scope

- In scope:
  - `packages/inboxd/**`
  - `packages/contracts/**`
  - `packages/assistant-core/**` where inbox capture ids surface through runtime or promotion helpers
  - Durable docs/tests that describe or verify inbox intake persistence
- Out of scope:
  - Redesigning downstream promotion flows beyond the intake-id references they already consume
  - Broad gateway/query model changes unrelated to inbox intake persistence

## Constraints

- Preserve unrelated dirty worktree edits, especially the active compatibility cleanup lane already touching `packages/inboxd/**` and `packages/contracts/**`.
- Keep the change narrow and avoid introducing a second compatibility abstraction for old intake writes.
- Update durable docs when the canonical-write rule changes.

## Risks and mitigations

1. Risk: Existing inbox surfaces still assume a persisted event or audit row exists for every capture.
   Mitigation: Trace event/audit id consumers first and either remove the assumption or keep only lightweight compatibility ids without appending extra ledgers.
2. Risk: Repair flows stop healing partially persisted historical captures.
   Mitigation: Keep raw-envelope recovery intact, but limit repaired canonical evidence to the inbox-capture ledger.
3. Risk: Tests overfit the old three-write batch and miss a downstream regression.
   Mitigation: Update the focused persistence/idempotency tests plus at least one higher-level caller test that previously asserted event/audit rows.

## Tasks

1. Trace the inbox canonical-write and repair paths plus any event/audit id consumers.
2. Refactor inbox persistence so canonical intake writes append only the inbox-capture ledger entry while preserving runtime indexing and promotion references.
3. Update contracts, docs, and focused tests to match the new intake rule.
4. Run required verification, complete the required final review audit, close the plan, and create a scoped commit.

## Decisions

- Keep `eventId` on canonical inbox-capture records and runtime surfaces for existing promotion/reference flows, but stop treating a peer `EventRecord` as required intake evidence.
- Make inbox-capture `auditId` optional so older ledger rows remain readable while new intake writes omit audit references entirely.
- Keep the low-level event/audit append helpers out of the production intake path for now; they remain only as compatibility/test helpers until the broader cleanup lane retires them.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:packages`
  - `pnpm test:smoke`
- Expected outcomes:
  - Typecheck passes.
  - Package tests and smoke checks pass, or any unrelated pre-existing failures are called out precisely.
- Outcomes:
  - `pnpm typecheck`: passed.
  - `pnpm test:smoke`: passed.
  - `pnpm exec vitest run packages/inboxd/test/inboxd.test.ts packages/inboxd/test/idempotency-rebuild.test.ts -t "processCapture|rebuildRuntimeFromVault|recovers from a crash after vault persistence" --no-coverage`: passed.
  - `pnpm exec vitest run packages/cli/test/assistant-service.test.ts -t "allows concurrent inbox canonical writes" --no-coverage`: passed.
  - `pnpm test:packages`: failed outside this diff in `packages/runtime-state/test/hosted-bundle.test.ts` with 7 hosted-bundle failures. The first attempted run also had an invalid prepared-artifact race because it overlapped with `pnpm typecheck`; the sequential rerun is the relevant result.
Completed: 2026-04-06
