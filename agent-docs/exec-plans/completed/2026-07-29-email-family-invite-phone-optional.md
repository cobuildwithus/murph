Goal (incl. success criteria):
- Let a member with a verified email accept an email-bound Family invite without supplying a phone number.
- Keep phone verification required before Murph assigns a new Linq/iMessage home line.
- Success means a focused regression test reproduces the current failure, the smallest activation-routing correction passes it, and existing phone, existing-thread, and Telegram behavior remains covered.

Constraints/Assumptions:
- The Family product contract already authorizes web acceptance through a matching verified email.
- Family acceptance and activation remain one transaction; do not split them or add retry/state machinery.
- Do not weaken invite identity binding or allow email identity to authorize a phone/iMessage sender.
- Reuse an existing Linq thread when one is already bound; otherwise activate email-only members without a signup welcome route.

Key decisions:
- Prove the failure at the activation boundary before editing production code.
- Correct route selection rather than catching or suppressing the downstream phone-required error.

State:
- Complete.

Done:
- Traced the email-bound web accept route through Family membership activation.
- Confirmed a verified email lookup is incorrectly treated as sufficient reason to attempt a new Linq home-line assignment.
- Add a focused activation regression test for a verified-email-only member with no existing messaging route.
- Corrected activation route selection so a phone-less member only enters Linq route resolution when an existing home or pending thread can be reused.
- Preserved phone verification before new home-line assignment, existing-thread reuse, Telegram routing, atomic activation, and the canonical activation event.
- Proved the focused regression failed before the production change and passed afterward.
- Passed the combined Family acceptance suite and the full affected `apps/web` diff verification.
- Completed product-experience review with no findings.
- Accepted the preliminary coverage finding and added activation-boundary tests for established and pending email-handle Linq threads.
- Passed the preliminary remediation proof: 77 focused tests, scoped ESLint, and `git diff --check`.
- Completed the parent final diff review with no remaining findings.

Now:
- Archive this completed plan and continue the immutable final ReviewGPT and exact-head CI gates.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/member-activation.ts
- apps/web/test/hosted-onboarding-member-activation.test.ts
- pnpm test:diff <touched paths>
Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
