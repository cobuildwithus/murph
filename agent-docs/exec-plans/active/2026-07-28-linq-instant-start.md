# Country-gated Linq instant start

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

Let a legitimate person who directly iMessages Murph start the canonical personal assistant immediately, with the existing 14-day and $4.50 Pulse trial, without opening the website first.

## Architecture

- Keep `HostedMember` as the only user identity. Privy remains the later browser-session authenticator and reconciles by the existing phone identity.
- Reuse the existing Stripe-backed no-card Pulse trial, activation, allowance, mailbox, and paid-conversion owners. Do not add a preview account, alternate entitlement, redemption ledger, queue, or runtime.
- Only a genuinely unknown member with a persisted first-contact decision of `kind: "allow"` and `source: "model"` can request instant start.
- Require an unbound Stripe customer before instant start so an existing saved payment method cannot silently auto-convert a trial started only by texting Murph.
- Limit instant start to provider-authenticated direct iMessage from a configured E.164 phone prefix and require the final home line to be the same line the person contacted.
- Keep SMS, RCS, group, email-handle, unsupported-prefix, classifier-fail-open, cross-line, and enrollment-failure paths on the existing signup-link behavior.
- The first planner transaction creates the canonical member, pending same-line route, and invite. The existing auto-trial owner runs outside the transaction. A second ordinary planner pass sees the active member and appends the original message once.
- Reuse the persisted event-scoped admission decision on retries, including when the first transaction already created an inactive member, so a concurrent duplicate cannot race the successful trial path into sending a stale signup link.
- Suppress the redundant signup welcome and signup email for instant start; Murph's answer to the original message is the welcome.
- Preserve the current consent boundary in this PR. In-chat health-consent prompting remains a separately reviewable change rather than being coupled to trial activation.

## Verification

- The implementation workflow rebased the source patch onto current `main`, verified patch checksums and whitespace, generated Prisma, and committed only after focused verification passed.
- Focused Linq eligibility, first-contact admission, planner/service, no-card trial, activation, environment, CSRF, and consent-boundary regressions passed.
- A dedicated retry regression proves that a stored model allow resumes the same inactive member, starts the trial once, appends the original inbound once, and never sends the stale signup link.
- `pnpm --dir apps/web typecheck` passed after Prisma and generated Health Commons preparation.
- `git diff --check` and staged-diff whitespace checks passed.
- Canonical PR CI and final review remain pending.
