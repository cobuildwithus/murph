# Country-gated Linq instant start

Status: completed
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

- The source implementation was integrated with current `main` through ordinary conflict-free merges; the final merge tree is clean.
- Prisma generation, focused Linq eligibility/admission/planner/service, no-card trial, activation, environment, CSRF, consent-boundary, retry, routing, and idempotency regressions passed.
- Post-merge focused proof passed with 221/221 trial-owner and Linq-dispatch tests plus 90/90 read-receipt, thread-route, and webhook-idempotency tests.
- A dedicated retry regression proves that a stored model allow resumes the same inactive member, starts the trial once, appends the original inbound once, and never sends the stale signup link.
- The required local product-experience review returned `NO FINDINGS`; it recorded live signed-Linq plus test-Stripe timing as a post-deploy evidence gap rather than requiring more runtime machinery.
- The exact-head preliminary specialist review returned three coverage findings and no production finding. Its checksum-verified test-only patch was inspected before application. The accepted regressions prove the locked saved-customer recheck, model-approved cross-line signup fallback, and one-shot fallback when enrollment resolves without observable active state.
- The complete production candidate passed release build/typecheck, release app verification, package and fixture coverage, both CLI host matrices, repo hygiene, viewport checks, and every hosted E2E required gate. The subsequent test-only type fixture correction also passed exact-head release build/typecheck before the final base-only merge.
- Local `pnpm test:diff ...` attempts twice reached the documented ten-minute shared-host admission cutoff. The required isolated fallback failed before creating a Testbox because the installed Blacksmith provider rejects the repo dispatcher's `--stop-after` flag. A local `pnpm verify:acceptance` attempt reached the same ten-minute admission cutoff. These were verification-infrastructure blockers, not test failures; exact-head PR CI remains the final canonical execution gate.
- Parent final review found no remaining production-path or proof issue after preliminary remediation.
- `git diff --check`, staged-diff whitespace checks, and identifier-leak scans passed before each scoped commit.
- Final exact-head ReviewGPT and green PR CI remain the merge gates.
Completed: 2026-07-28
