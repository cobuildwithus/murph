# Group offer affirmation lock-order remediation

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Ensure Telegram group-offer affirmation and terminal account deletion always
  acquire shared database owners in the canonical group-before-member order,
  without weakening binding revalidation or adding retry machinery.

## Success criteria

- The affirmation owner acquires its existing group/member locks before the
  Telegram binding recheck and before any accepted side effect.
- A changed Telegram binding still rolls back the complete grant transaction.
- Real-PostgreSQL tests exercise both account-deletion/Telegram acquisition
  orders without deadlock and retain relink rollback proof.
- Focused tests and Web typecheck pass; the draft PR receives a pushed exact
  candidate head and complete public-safe evidence.

## Scope

- In scope: the shared group-offer affirmation transaction ordering, focused
  unit assertions, actual Telegram callback PostgreSQL concurrency proof, and
  the corresponding test-map/PR evidence.
- Out of scope: retries, new lock managers, schema changes, unrelated account
  deletion paths, Ready/merge/deploy, and launching another ReviewGPT round.

## Constraints

- Technical constraints: preserve the existing transaction boundary and
  group-before-member lock owners; keep provider/KMS work outside the
  transaction; rely on rollback for failed post-lock binding revalidation.
- Product/process constraints: this is a Patch restoring the existing reliable
  Telegram offer-tap and terminal-deletion promises. Keep PR #2345 Draft and
  stop after pushing the corrected candidate for parent-coordinated review.

## Risks and mitigations

1. Risk: moving revalidation could permit a stale Telegram binding to commit.
   Mitigation: keep revalidation inside the same transaction, after the
   canonical group/member locks and before `onAcceptedTx` or commit, and prove
   rollback through the real callback.
2. Risk: a seam-only test could miss the production adapter's member lock.
   Mitigation: run both acquisition orders through
   `handleHostedTelegramGroupOfferCallback` with independent Prisma clients.

## Tasks

1. Reorder existing affirmation callbacks without adding an owner or retry.
2. Add focused unit ordering and real-PostgreSQL callback/deletion races.
3. Run scoped verification and inspect the diff for simplicity and privacy.
4. Finish the plan in a scoped commit, push the draft branch, and refresh PR
   evidence without starting ReviewGPT or Ready/merge/deploy actions.

## Decisions

- Reuse the canonical acceptance functions as the sole group/member lock owner.
- Run Telegram binding revalidation only after an acceptance owner has acquired
  those locks; failed revalidation aborts the same transaction atomically.
- Publish one narrow outcome-level changelog item because members can experience
  the reliability improvement; omit database and deletion implementation detail.

## Verification

- Commands to run: focused group-offer unit tests, the opt-in real-PostgreSQL
  group outreach/deletion suite, Web typecheck, docs drift, and diff checks.
- Expected outcomes: deterministic ordering, both database interleavings and
  relink rollback pass, no type errors, no doc drift, and no private material in
  the patch.
- Results:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/hosted-group-telegram-offer-callback.test.ts`: 55 passed.
  - Focused opt-in PostgreSQL run with `-t "Telegram"`: 3 passed, 32 skipped.
  - `pnpm --dir apps/web test -- changelog-page.test.tsx`: 9 passed.
  - `pnpm --dir apps/web typecheck:prepared`: passed.
  - `pnpm docs:drift`: passed.
  - `git diff --check` and the private-identifier scan: passed.
  - The documented unfiltered PostgreSQL file command also ran: 27 passed and
    8 failed. Three target cases failed on their first fixture iteration and
    passed after correction; five unrelated cases require undocumented hosted
    crypto setup or missed an existing timing assertion. Frog entry
    `20260826222133-document-local-crypto` records the reproducible command gap.
Completed: 2026-08-26
