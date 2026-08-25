# Remove contact details from internal signup notifications

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Keep the internal hosted signup email useful while ensuring it never reads or
  includes a member's email address or phone number.

## Success criteria

- The notification body retains signup time, source, and approximate network
  location when available.
- The send path performs no member email-authorization read for notification
  enrichment.
- Focused tests prove that email and phone labels and values are absent.
- Architecture and security contracts explicitly prohibit contact details in
  this notification.
- Focused local proof, exact-head CI, the preliminary coverage review, and the
  final privacy-sensitive ReviewGPT gate complete with no unresolved accepted
  finding.

## Scope

- In scope:
  - The hosted signup notification formatter and its direct data reads.
  - Focused notification tests.
  - Current architecture and security documentation for this email boundary.
- Out of scope:
  - Signup welcome emails sent to members.
  - Notification recipients, delivery ownership, idempotency, retention, or
    signup-context collection.
  - Other billing, authentication, or contact-detail storage behavior.

## Constraints

- Preserve the existing at-most-once attempt claim and Resend idempotency key.
- Preserve the plain-text-only body, source fallback, approximate-location
  label, and context expiry behavior.
- Add no new state, dependency, formatter layer, or compatibility path.
- Keep private examples and direct identifiers out of tests, docs, commits, and
  PR artifacts.

## Evidence and ownership

- The current notification owner is
  `apps/web/src/lib/hosted-onboarding/signup-notification-email.ts`.
- Static tracing shows it decrypts hosted member email authorization only to
  append an `Email:` line; no phone value is currently formatted by this owner.
- The smallest durable correction is to delete that read and formatter input,
  then make contact-detail absence a regression assertion.

## Risks and mitigations

1. Risk: removing enrichment accidentally suppresses or changes the operational
   notification.
   Mitigation: retain the same send and attempt-claim flow and assert the full
   remaining body.
2. Risk: a future change reintroduces a contact field.
   Mitigation: document the prohibition and assert that both email and phone
   labels and representative values are absent.

## Tasks

1. Delete the email-authorization read and contact-detail formatter input.
2. Replace email-enrichment tests with direct privacy regression coverage.
3. Update the architecture and security contracts at the existing notification
   boundary.
4. Run focused Web tests, typecheck, durable-doc checks, and parent diff review.
5. Commit and push a draft PR, then run the preliminary coverage pass and final
   ReviewGPT gate concurrently with exact-head CI.
6. Resolve accepted findings, close this plan with `scripts/finish-task`, prove
   current-base mergeability, and hand off the completed PR/worktree.

## Product UX classification

- Internal-only operational change. No member-facing journey or product-owned
  dimension changes, so the Product UX, prompt, and frontend lenses are not
  applicable. The coverage lens is applicable.

## Deployment classification

- One Web deploy changes the content assembled for future signup notifications.
  Old instances may still include an email address during rollout; deploy the
  privacy-reducing version normally, then confirm a fresh notification contains
  no contact details. No schema or cross-service order is required.

## Verification

- `pnpm --dir apps/web typecheck` passed.
- Focused hosted Web Vitest passed: one file, 12 tests.
- `pnpm docs:drift` passed.
- `git diff --check` and the changed-content direct-identifier scan passed.
- The first focused test attempt reproduced the already-linked clean-worktree
  Prisma-generation friction. Running the required Web typecheck generated the
  client, and the unchanged focused test then passed.
