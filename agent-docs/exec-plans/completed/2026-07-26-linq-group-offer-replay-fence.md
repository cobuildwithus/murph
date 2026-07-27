# Linq group-offer replay fence

Status: completed
Created: 2026-07-26
Updated: 2026-07-27

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

1. Keep the existing nullable application-state field and add one nullable
   JSON claim field to the same Linq provider-event owner. Versioned pending
   state binds the receipt to the resolved member, exact current membership id,
   group runtime member, and a hash of the selected-share authority visible in
   the receipt transaction.
2. Capture that claim before inserting the provider event, under the existing
   group/member lock order. Exact duplicate insertion never creates or replaces
   a claim on an older row.
3. On pending retry, recompute the same authority under lock. A mismatch moves
   the receipt to terminal `superseded:v1`; an exact match is the only path that
   may join and transition to `applied:<membershipId>`.
4. For applied replay, return an accepted canonical no-op only while the exact
   recorded membership exists; otherwise stop without membership/share
   mutation. Null, malformed, and legacy bare-pending rows fail closed.
5. Add focused store, webhook, migration, and real-PostgreSQL sequential/race
   coverage, keeping Telegram and disclosure behavior unchanged, and update
   only the current schema-owner and reliability documentation.

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
- Parent final review found no remaining correctness, architecture, rollout,
  or coverage gap after the specialist remediation.
- After rebasing onto current `main`, the final canonical `pnpm test:diff ...`
  passed in Blacksmith Testbox `tbx_01kygrddd9aw745aakx6j55jxq`, including
  all 536 Web test files, 6,838 tests, typecheck, lint, production build, and
  repository policy/architecture guards.
- The final `pnpm verify:acceptance` passed in Blacksmith Testbox
  `tbx_01kygrx92q3c0z5y5xc8fchzxt`, including the full package and application
  acceptance surface.
- Final ReviewGPT round 1 on immutable head
  `4f60f134456642d332146f148f02dbc7799a56bb` found one remaining authority
  gap: a receipt whose acceptance transaction rolled back retained an
  unqualified `pending` marker, so a later retry could bind to newer membership
  or share authority.
- Remediation will bind pending state on the existing provider-event owner to
  the resolved member, exact membership generation, and receipt-time share
  authority. Superseded retries will terminally no-op under the existing
  group/member locks.
- The same-thread ReviewGPT remediation response was model-verified and supplied
  patch SHA-256
  `3072bca857292c89d822ef84b0399f770b870a648e9745c839d6dd517022c535`.
  All 2,263 lines were inspected before its hunks were deliberately applied
  with the repository edit tool.
- In the tests-only state, the new receipt-binding, supersession, migration,
  and confirmation-suppression cases failed as expected. That exploratory
  runner was stopped after producing the failure evidence because it did not
  exit; the exact six-suite post-fix run completed with 218 passing tests.
- Parent inspection preserved the pre-existing 410 result for a currently
  revoked offer and normalized the expansion migration to the repository's
  canonical statement shape. No additional owner, table, queue, or lifecycle
  state was introduced.
- Hosted Web typechecking passes after preserving the narrowed join-code value
  across the no-mutation result helper.
- A fresh isolated loopback PostgreSQL database applied the full migration
  history including the claim expansion. The real receipt/rollback,
  membership-generation, share-authority, leave/rejoin, and concurrency proof
  passes all 8 tests; the disposable database was removed afterward.
- Canonical local `pnpm test:diff <all changed paths>` passes with the new claim
  migration and active plan explicitly included, covering the full Hosted Web
  test, typecheck, lint, build, and repository guard surface.
- Canonical local `pnpm verify:acceptance` passes across the full package and
  application acceptance surface.

## Deployment

- Expand the existing provider-event schema before application code writes or
  reads the new state.
- Null legacy rows are intentionally ambiguous and fail closed; current
  memberships may still run idempotent post-commit confirmation recovery.
- No Cloudflare Worker or runner protocol changes are expected.
Completed: 2026-07-27
