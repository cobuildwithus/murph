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
- Focused local proof, exact-head CI, the unified preliminary Product UX,
  prompt, and coverage review, and the final privacy-sensitive ReviewGPT gate
  complete with no unresolved accepted finding.

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
5. Commit and push a draft PR, then run the unified preliminary specialist pass
   and final ReviewGPT gate concurrently with exact-head CI.
6. Resolve accepted findings, close this plan with `scripts/finish-task`, prove
   current-base mergeability, and hand off the completed PR/worktree.

## Product UX plan

- Classification: Product change. The existing internal-recipient journey
  keeps its purpose while the data disclosed in the message becomes narrower.
- Outcome: A configured internal recipient can recognize when, where, and
  through which surface a signup occurred without receiving the member's
  contact details.
- Entry and promise: A completed activation schedules one post-response email;
  it remains one-shot, plain text, and context-free when optional request
  context is unavailable.
- Affected people:
  - The internal recipient keeps the operational time, source, and approximate
    location needed to understand a signup.
  - The member receives no new surface, but their email address and phone number
    are not disclosed through this internal notification.
- Proof path: The focused provider-boundary test exercises a representative
  context-rich notification and proves the complete retained body, no contact
  labels or selected address, and no email-authorization read. The fallback
  test proves the sparse-context message remains useful.
- Done when: Both message shapes send through the existing owner without contact
  details and without changing delivery, attempt claiming, recipients, or
  idempotency.

## Preliminary specialist applicability

- Product UX: applicable because the internal recipient reads a changed email
  and the triggering member has a narrower privacy exposure.
- Prompt: applicable because the patch changes live agent-facing architecture,
  security, index, and execution-plan instructions.
- Frontend: not applicable because no rendered Web UI changes.
- Coverage: applicable because executable provider-bound email assembly and its
  direct proof change.

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
- Preliminary specialist review found one medium process-description issue:
  the plan and PR body incorrectly treated Product UX and prompt review as not
  applicable. Accepted and corrected as non-production plan/PR metadata; the
  review found runtime coverage sufficient and returned no patch artifact.
- Final ReviewGPT round 1 passed with no qualifying findings on the immutable
  production candidate.
- The automatic ready-to-draft controller failed its exact pull-request lookup
  after the docs-only remediation push. Logged the new public-safe Frog entry
  `20260825122035-pr-head-draft` and used the normal explicit draft transition
  before the final candidate push.
