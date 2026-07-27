# Linq group-offer replay fence

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Prevent an exact redelivery of a previously applied Linq join affirmation
  from recreating membership or restoring shares after a later leave/revoke.
- Preserve retry of a received event whose acceptance transaction never
  committed, and preserve post-commit confirmation retry without repeating
  canonical membership/share writes.

## Proven cause

- Linq provider-event ingestion records only receipt and deliberately re-enters
  affirmation handling for exact duplicates.
- The join branch drops the affirmation event identity before its transaction;
  membership existence is its only effective dedupe state.
- Leaving revokes shares and deletes membership, so replay of the still-active
  offer creates a new membership and changes revoked shares back to granted.
- The existing disclosure branch is event-derived and retains revoked grants;
  Telegram has no production offer sender on current main and is out of scope.

## Constraints

- Reuse `HostedLinqProviderEvent` as the one durable applied-event owner.
- Do not gate on the webhook's duplicate flag; receipt-before-acceptance
  failures must remain retryable.
- A legacy provider-event row from old code must fail closed, while a new event
  must be explicitly marked pending at ingestion.
- An applied marker must carry the exact accepted membership id so replay
  cannot attach confirmation recovery to a later rejoin.
- Exact applied replay may retry confirmation only while that exact membership
  exists, without re-granting any projection. Legacy replay always fails closed.
- A genuinely new event may intentionally rejoin.
- Add no table, queue, scheduler, manager, compatibility service, or soft-delete
  membership lifecycle.

## Approach

1. Add one nullable closed-state field to the existing Linq provider-event row:
   old/null is legacy ambiguous, new reactions ingest as pending, and successful
   join acceptance moves pending to `applied:<membershipId>` in the same
   transaction.
2. Thread the Linq affirmation identity into join acceptance and bind it to the
   stored event type/message context.
3. For applied replay, return an accepted canonical no-op only while the exact
   recorded membership exists; otherwise stop without membership/share
   mutation. Legacy replay fails closed.
4. Add focused store, webhook, migration, and real-PostgreSQL sequential/race
   coverage, keeping Telegram and disclosure behavior unchanged.
5. Update only current reliability/security/schema-owner documentation needed
   for the persisted-state and rollout contract.

## Verification

- Focused Linq provider-event, group-store/affirmation, webhook idempotency, and
  migration tests.
- Real-PostgreSQL accept/leave/replay, share-revoke replay, retry-before-commit,
  concurrent leave/replay, and fresh-event controls.
- `pnpm test:diff ...` for every changed path.
- `pnpm verify:acceptance`.
- Preliminary `completion-specialists`, parent final review, then final
  `pr-review` rounds concurrent with CI.

## Evidence to date

- ReviewGPT implementation patch attachment SHA-256:
  `9a71043ea89d2ba7a473a5311a494b032e0a0c664cca21b05532a997fd6650f0`.
  The complete 1,786-line patch was inspected and passed
  `git apply --check --whitespace=error-all` before its hunks were applied with
  the repository edit tool.
- Before the production fix, the added store regressions produced ten focused
  failures while 58 existing tests passed. The failures covered absent applied
  state, replay after leave or rejoin, share-revocation replay, and legacy or
  mismatched event binding.
- The focused in-memory suites pass with 203 tests and three opt-in tests
  skipped; the dedicated store suite passes 68 tests.
- A fresh isolated local PostgreSQL database applied all 128 migrations, and
  the real concurrent accept/leave/replay suite passes all three tests.
- Hosted Web TypeScript checking passes after narrowing the test-only
  leave-release callback.
- The generated patch's unnecessary `CHECK ... NOT VALID` constraint was
  removed because the production migration guard correctly rejected it. The
  nullable no-default expansion needs no constraint.
- The hosted CI workflow guard passes, and the new PostgreSQL proof now runs in
  the existing Linq route-authority job.
- The production migration guard passes all 36 focused cases, and Prisma
  validates the updated schema.
- `pnpm docs:drift` passes after updating the durable-doc index.
- Preliminary `completion-specialists` reviewed exact pushed head
  `7b2584f1bc849c49174b66ec3742a3bb73cf6a85` and returned three test-only
  coverage findings: canonical migration inventory/shape, null-membership
  confirmation suppression, and blind-index rotation of the Linq chat binding.
  Its owned coverage patch SHA-256 is
  `b848edb86ed0108f9ceac34e39cb1fdcfd7b4de50370b82565315e52dd23e0c7`.
  All 129 lines and both paths were inspected, the patch passed
  `git apply --check --whitespace=error-all`, and its test-only hunks were
  applied deliberately.
- The four focused remediation suites pass all 126 tests.

## Deployment

- Expand the existing provider-event schema before application code writes or
  reads the new state.
- Null legacy rows are intentionally ambiguous and fail closed; current
  memberships may still run idempotent post-commit confirmation recovery.
- No Cloudflare Worker or runner protocol changes are expected.
