# Linq instant start

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Let a legitimate person who directly iMessages Murph start the canonical personal assistant and ordinary Pulse trial without opening the website.
- Keep one member, one trial policy, one runtime, and one consent ledger.
- Bound obvious token farming with the existing model admission classifier plus an explicit supported-country calling-code allowlist, rather than a second low-value starter allowance or per-line grant ledger.

## Success criteria

- A new, model-admitted, direct iMessage from a configured calling code on the selected home line creates one canonical `HostedMember`, grants the existing Pulse trial policy and its full $4.50 allowance, activates the existing workspace/runtime, and appends the original message atomically.
- SMS, RCS, group, unattributed, unsupported-calling-code, classifier-fail-open, and cross-line first contacts retain the existing signup-link or ignored behavior.
- Privy is not called on first contact; a later phone login reconciles to the same member through the existing phone lookup.
- Missing health consent is injected as current server-owned turn context. Murph asks for the canonical in-chat disclosure only when personal health use begins. An exact direct `I AGREE` reply records current launch and health-AI grants before the reply enters the assistant.
- Existing billing, family, thread-container, usage, route, line-health, and mailbox owners remain authoritative; no second queue, preview user, retained redemption ledger, or alternate runtime is added.
- Focused first-contact, access, allowance, consent, contract, runtime-port, concurrency, and regression tests pass, followed by canonical diff verification.

## Architecture

- Reuse `HostedMemberBillingRef`'s existing Pulse-trial fields for the direct trial. The row may carry trial entitlement before Stripe identifiers exist; `hosted_member.billing_status` remains the member's Stripe relationship and stays `not_started`.
- Reuse the existing Pulse trial policy constants and allowance resolver. Direct-trial access is identified by a valid current Pulse-trial shape with no Stripe subscription binding.
- Extend the existing webhook plan/prepare/replan pattern so a candidate member id and KMS envelopes are prepared outside the final transaction. The final transaction owns member creation, route bind, trial grant, activation, and conversation append.
- Reuse the existing signed Web callback boundary for a small read-only health-consent status port. The runtime converts missing consent into a private direct-turn prompt; no model-callable grant action exists.
- Deterministic webhook processing alone records exact `I AGREE` consent evidence. Incoming text is never blocked merely because documents are stale or consent is missing.

## Security decisions

- The classifier is spam friction, not the economic boundary. Only an actual model `allow` decision can enter instant start; deterministic fail-open decisions can still preserve the old signup path but cannot create a trial.
- Instant start is configurable only through `HOSTED_ONBOARDING_LINQ_INSTANT_START_CALLING_CODES`. An empty list disables it. Calling-code matching is a launch allowlist, not a claim of nationality or perfect fraud detection; `+1` covers the full NANP.
- Require provider-authenticated direct iMessage evidence and same-line continuity. Do not silently start from SMS/RCS or open a new conversation from another line.
- The existing daily inbound quota and $4.50 included-usage gate remain the spend limit. Do not add a $0.50 tier, per-line dollar cap, retained phone-redemption table, or new account lifecycle.
- Health consent accepts only the exact normalized phrase `I AGREE` from the member's authenticated direct iMessage thread. General yes/no language and unrelated reactions do not grant consent.

## Tasks

1. Add the supported-calling-code policy and focused parsing/matching tests.
2. Add the external KMS prepare/replan seam, direct trial grant, non-billing activation, same-line first-message append, and idempotency/concurrency tests.
3. Teach canonical access and usage owners to recognize the existing direct Pulse-trial shape while preserving paused or lapsed Stripe behavior.
4. Add the read-only consent status contract/port, direct-turn prompt, deterministic exact-reply grant, onboarding guidance, and consent tests.
5. Update durable architecture/security/reliability/iMessage docs and configuration examples.
6. Run focused checks, canonical `pnpm test:diff`, parent review, PR ReviewGPT/CI, then archive this plan and remove its ledger row.

## Overlap coordination

- Preserve the active hosted-ingress wake-repair work in `webhook-*`; this change touches only first-contact planning/preparation and keeps the existing handoff owner.
- Preserve PR 144's narrow usage-limit notice work in `usage-allowance.ts`; this change is limited to direct-trial access admission and period derivation.
- Preserve the signup-timezone handoff in `member-activation.ts`; direct instant start passes the existing activation timestamp/timezone behavior through unchanged and only suppresses the redundant signup welcome.

## Verification

Pending implementation.
