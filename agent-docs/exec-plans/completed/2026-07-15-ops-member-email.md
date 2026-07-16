# Ops member email composer

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Add an authenticated ops tool that resolves one or more explicit member IDs
  to existing authorized email records, previews the send, and delivers a
  plain-text message through the existing Resend configuration.

## Success criteria

- `/ops/email` accepts up to 100 member IDs plus a subject and plain-text body.
- Preview shows each supplied member ID as ready or skipped without returning
  or rendering any email address.
- Send requires the exact signed Preview, rechecks member and recipient state,
  and submits one separate email per ready member in a single Resend batch.
- Account-deletion-suspended members, unknown members, and members without an
  authorized recipient are never sent email.
- A lost or ambiguous Send response can be retried with the same Preview
  without duplicate delivery.
- Logs contain aggregate outcome and provider status only, never member IDs,
  addresses, subject text, or body text.

## Scope

- In scope: the hosted ops landing page, a new email composer page and client,
  a member-email ops route/service, a reusable strict Resend plain-text batch
  sender, shadcn Field/Textarea components, focused tests, and operator docs if
  an existing durable ops guide owns this surface.
- Out of scope: campaigns, audience discovery, scheduled delivery, HTML email,
  attachments, templates, contact-list storage, database schema changes, and
  sending any real email during verification.

## Constraints

- Reuse the current ops allowlist and same-origin mutation boundary.
- Reuse encrypted member email authorization records, preferring verified
  email and falling back to the Stripe checkout email already permitted by
  existing transactional email flows.
- Reuse the contact-privacy keyring for a short-lived signed preview; add no
  new secret, dependency, database state, queue, or scheduler.
- Keep member IDs only in the authenticated operator response and UI, not in
  server logs or committed examples.
- Use Resend's strict batch endpoint so invalid provider input cannot produce a
  partial send, and bind one provider idempotency key to the signed Preview.

## Risks and mitigations

1. Risk: the operator sends to a different recipient set or draft than shown.
   Mitigation: sign the normalized IDs, exact subject/body, recipient state,
   and preview timestamp; re-read and verify all inputs before Send.
2. Risk: a timeout causes duplicate email delivery on retry.
   Mitigation: derive one stable Resend idempotency key from the Preview token
   and retain the same proof after an ambiguous response.
3. Risk: private email data leaks through the API, UI, or logs.
   Mitigation: return only member-scoped eligibility labels, keep recipient
   addresses server-side, and log aggregate counts plus safe provider status.
4. Risk: an account-deletion privacy fence changes after Preview.
   Mitigation: include suspension and recipient state in the proof and reject a
   stale Send before contacting Resend.

## Tasks

1. Add bounded member/draft validation, recipient resolution, and signed
   Preview/Send behavior.
2. Add strict plain-text Resend batch submission with safe error projection and
   retry-stable idempotency.
3. Add the ops page, composer, preview summary, per-member status list, and an
   explicit irreversible Send action using existing design-system primitives.
4. Add service, route, Resend boundary, and client interaction coverage,
   including privacy, staleness, suspension, fallback, and retry behavior.
5. Run focused and routed verification, browser proof, required security,
   frontend, and coverage audits, then finish the plan with a scoped commit and
   exact-head PR gates.

## Decisions

- The batch is operator-selected, never query-derived. This tool does not infer
  an audience from billing or activity state.
- Billing status does not block a send because the tool must support active and
  lapsed-trial members. The account-deletion suspension fence always blocks it.
- Each Resend batch item has exactly one recipient, so recipients cannot see
  one another's addresses.
- The provider call uses strict validation. A provider-level rejection fails
  the whole batch and leaves the same Preview available for a safe retry.

## Verification

- Focused hosted-web tests: 5 files, 111 tests passed. Coverage includes
  mixed eligible/skipped batches, verified-email precedence, address privacy,
  stable retry idempotency, independent recipient-state staleness, exact draft
  preservation, client response validation, and form accessibility.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm --dir apps/web lint`: passed with 0 errors and the 12 pre-existing
  warnings.
- `pnpm test:diff`: passed. The routed web lane ran 428 passing test files plus
  2 skipped, 5,163 passing tests plus 139 skipped, the production Next build,
  dev smoke, typecheck, lint, and workspace guards.
- Coverage-write audit: passed after adding five focused proof cases; no
  material gap remains.
- Frontend audit: the first pass found exact-draft, long-ID, assistive-text,
  failure-label, and design-gallery gaps. All five were remediated and the
  remediation re-audit was clean; its focused client suite passed 10 tests.
- The local app compiled and reached Ready on the isolated worktree port, but
  the in-app browser runtime exposed no browser instance. Desktop/mobile
  rendered inspection and screenshots could not be captured. No real email
  was sent during verification.

## Outcome

- Added `/ops/email`, where an authenticated operator can enter up to 100
  explicit member IDs, compose one plain-text draft, Preview eligibility, and
  deliberately Send only to ready recipients.
- Recipient addresses remain server-side. Unknown, suspended, and no-email
  members are visibly skipped by member ID.
- Send rechecks current member/recipient/sender state against a short-lived
  HMAC-bound Preview and uses one stable Resend batch idempotency key for safe
  ambiguous-response retries.
- Reused the existing ops boundary, encrypted email authorization records,
  contact-privacy keyring, and Resend configuration without a schema,
  dependency, queue, or scheduler.
Completed: 2026-07-15
