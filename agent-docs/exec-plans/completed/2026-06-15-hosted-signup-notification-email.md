# Hosted Signup Notification Email

## Goal

Send an internal best-effort email when hosted Stripe reconciliation reaches the
same normalized activation point that already triggers the member welcome email.

Success criteria:

- no new webhook route or Stripe event interpretation
- notification is gated by `HOSTED_SIGNUP_NOTIFICATION_EMAILS`
- customer welcome email behavior stays unchanged
- Stripe reconciliation never fails because the internal notification send fails
- focused tests cover config parsing, recipient handling, member email selection,
  provider failure tolerance, and reconciliation callsite behavior

## Constraints

- Reuse the existing Resend API key and welcome-email sender config.
- Do not commit personal recipient addresses; deployment env owns the concrete
  internal recipient list.
- Keep email body plain text and avoid logging recipient/customer identifiers.
- Preserve hosted billing and onboarding invariants in `ARCHITECTURE.md` and
  `agent-docs/SECURITY.md`.

## Plan

1. Mirror the existing signup welcome email helper for an internal notification
   helper with env-only configuration and stable idempotency key.
2. Call the helper after the existing welcome email attempt when
   `welcomeEmailMemberId` is present.
3. Add focused tests for helper behavior and one reconciliation assertion.
4. Run required hosted-web verification plus security/privacy, coverage, and
   deep-review audit passes.
5. Close this plan through `scripts/finish-task`, push the branch, open a draft
   PR, and set the production environment variable outside git.

## Audit Needs

- `security-privacy-review`: external email egress, billing side effect, env
  config, and customer/contact exposure behavior.
- `coverage-write`: tests for the new helper and reconciliation callsite.
- `deep-review`: sensitive billing/external-egress side effect ordering.

## Verification

Initial target: `bash scripts/workspace-verify.sh test:diff <touched files>`
after implementation. Escalate to `pnpm verify:acceptance` if diff-aware
coverage is not truthful enough for the hosted-web change.

Completed:

- `bash scripts/workspace-verify.sh test:diff <touched files>` passed.
- `pnpm --dir apps/web typecheck:prepared` passed.
- `git diff --check` passed.
- Scoped identifier scan over changed files passed.
- Security/privacy, coverage-write, and deep-review audit passes found no
  blocking findings.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
