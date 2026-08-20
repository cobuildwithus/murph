# Manual Meal Photo Submission

Status: active
Started: 2026-08-20

## Outcome

Let an authenticated iOS companion member explicitly send a sanitized meal
photo selected from Apple's camera or system Photos picker without enrolling in
automatic capture. The backend must reuse the existing private meal-photo
staging, mailbox, runtime-wake, import, and cleanup owners.

## Product UX

Effort: Feature.

Affected people:

- A member who keeps automatic capture off can select or take a meal photo,
  review it locally, and explicitly send it.
- A member with automatic capture on gets the same foreground path without
  changing or duplicating automatic-capture authority.
- A member whose access, consent, identity binding, or private delivery route
  changes during upload gets a typed failure and retains the unsent local item
  for recovery.

Non-goals: no app-owned photo browser, historical library scan, persisted
manual queue, new photo data model, original-file upload, editing, captions, or
change to automatic-capture enrollment.

## Architecture

- Add one identity-authenticated companion route accepting a single strict,
  bounded JPEG with schema, capture time, and request-local idempotency headers.
- Derive the canonical 64-character capture id from a member-bound namespace
  and the caller's UUID idempotency key so the existing hosted meal-photo event
  contract stays unchanged.
- Extract the existing staging/mailbox/wake sequence behind one shared helper.
  Automatic upload retains its scoped enrollment recheck; manual upload locks
  the member and sponsored-access rows, rechecks the verified Privy binding,
  active access, and historical consent immediately before mailbox commit.
  Both paths also compare the exact raw routing and verified-email state used
  to build the envelope under the owning row locks immediately before append.
  Privy ownership uses its blind-index core projection, and mailbox payload
  crypto is prepared before the database-only final transaction begins.
- Store no JPEG bytes or new manual-upload records in Postgres. Ambiguous append
  cleanup continues to reconcile the existing mailbox claim before deletion.

## Steps

1. Add strict manual-upload validation and member-bound idempotency derivation.
2. Reuse the existing meal-photo ingestion owner from automatic and manual
   routes without weakening either authority boundary.
3. Add focused validation, route, final-recheck, duplicate, and cleanup tests.
4. Update architecture, security, and native contract docs. Publish the public
   changelog only with the coordinated native release.
5. Run focused local proof, push the exact candidate, and complete required
   preliminary and final ReviewGPT gates with green CI.

## Verification

- Focused Vitest for meal-photo validation and companion routes.
- Web TypeScript typecheck for the changed route/lib graph.
- Exact-head required GitHub checks, specialist ReviewGPT, final ReviewGPT, and
  current-base merge-tree proof.
- Native counterpart independently runs XcodeGen, SwiftFormat lint, focused
  unit tests, simulator build/tests, and exact-head visual evidence.
