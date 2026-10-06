# Cancellation recipient fallback

Status: active
Created: 2026-10-06
Updated: 2026-10-06

## Outcome and invariant

Reach the billing owner when Murph has no stored verified or checkout email.
The existing cancellation sender owns delivery. Only after authoritative local
cancellation and ownership checks, retrieve the canceled Stripe subscription with
its customer expanded and use its normalized billing email as the final fallback.
Never store this address as verified identity or send to other family seats.

## Evidence and scope

Family checkout reconciliation does not persist a member checkout email, so the
existing local-email-only sender can skip otherwise valid Family cancellations.
Use one existing Stripe SDK read (five-second timeout, zero SDK network retries)
outside the billing transaction, only with email configuration present and no
stored recipient. Read failure propagates to the existing Stripe receipt retry.
No schema, new queue, permission grant, identity mutation, or historical resend.

## Product UX

Outcome: The same cancellation follow-up reaches the subscription billing contact.
Reaches: Individual and Family billing owners without a stored recipient.
Proof: Stored-recipient precedence, canceled subscription with expanded customer,
deleted or absent customer email, non-canceled provider state, and failed read retry.

## Tasks and verification

Implement the sender fallback, run focused sender/reconciliation/Family suites,
Web typecheck, lint, complexity and changelog render. Refresh final ReviewGPT
because the provider boundary changed. Exact-head CI remains the PR gate.

## Local proof

Five focused billing/email and changelog suites: 469 tests passed. Web typecheck,
focused ESLint, complexity guard and diff whitespace checks passed. Parent review
confirmed no identity writes, provider reads under locks, or new recipient fanout.
External round 2 and exact-head CI remain pending.
