# Send hosted signup welcome email as plain text only

Status: completed
Created: 2026-05-28
Updated: 2026-05-27

## Goal

- Remove the HTML body from the Resend-backed hosted signup welcome email so
  the provider receives only the plain text body.

## Success criteria

- The Resend payload for the signup welcome email includes `text` and does not
  include `html`.
- Routing guidance in the email remains present as plain text.
- No raw recipients, provider payloads, API keys, local paths, or contact
  identifiers are exposed in logs/docs/tests beyond synthetic placeholders.
- Focused tests and required repo verification pass, or unrelated blockers are
  recorded precisely.

## Scope

- In scope:
  - `apps/web` hosted signup welcome email send payload.
  - Focused welcome-email tests.
  - Durable docs if they need to describe the plain-text contract.
- Out of scope:
  - Changing welcome email copy.
  - Changing Resend provider behavior, idempotency, or recipient selection.

## Constraints

- Preserve the existing once-only activation welcome behavior.
- Preserve env-only Resend configuration and sanitized logging.
- Preserve unrelated dirty worktree edits.

## Tasks

1. Remove the HTML body from the Resend payload.
2. Simplify any HTML-only helpers or fields.
3. Update focused tests to assert no HTML payload is sent.
4. Run required verification and audits.
5. Close the plan and create a scoped commit if safe.

## Decisions

- Use Resend's plain `text` field only. Do not send unstyled HTML as a second
  representation, because the requested behavior is raw text.

## Verification

- `pnpm exec vitest run apps/web/test/hosted-signup-welcome-email.test.ts --config apps/web/vitest.config.ts --no-coverage` passed.
- `pnpm typecheck` passed.
- `pnpm test:diff ARCHITECTURE.md agent-docs/SECURITY.md apps/web/README.md apps/web/src/lib/hosted-onboarding/signup-welcome-email.ts apps/web/test/hosted-signup-welcome-email.test.ts` passed.
- `git diff --check` passed for the scoped code/docs/tests plus active plan and ledger.
- Focused HTML/styling residue scan found no production Resend `html` payload or removed helper residue.
- Coverage review made no changes and found the focused tests sufficient.
- Security/privacy review found no findings; the plain text body still contains the selected Murph contact route by design.
- Final task review found no findings.
Completed: 2026-05-27
