# Unified group funding contract

Status: completed
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Give hosted groups one low-capacity and exhaustion behavior regardless of whether a monthly sponsorship exists.

## Success criteria

- Low-capacity groups suppress an assistant-initiated funding ask only while an automatic $5 refill is available or already pending.
- Low-capacity groups with no automatic recovery available receive the ordinary group funding heads-up.
- Exhausted groups always receive the ordinary pause copy and a current first-party funding link.
- Assistant-visible group usage state contains no sponsorship-status branch.
- Existing single-automatic-sponsor billing, payer privacy, and one-time contribution behavior remain intact.

## Scope

- In scope: group usage projection, low-usage assistant contract, exhaustion notice projection, focused tests, and matching durable documentation.
- Out of scope: multiple simultaneous monthly sponsors, payment or schema redesign, replaying a notice for a historical capacity period, and usage-cost optimization.

## Constraints

- Technical constraints: derive urgency from current capacity and refill authority without exposing payer, cap, amount, purchase, or refill details to the assistant.
- Product/process constraints: preserve urgent-turn deferral, single-sponsor billing, exact first-party link validation, and existing provider delivery ownership.

## Risks and mitigations

1. Risk: Murph asks for funding while a refill is already in flight.
   Mitigation: treat a pending automatic refill as available recovery for low-capacity projection.
2. Risk: sponsorship privacy leaks through the unified copy.
   Mitigation: remove sponsorship status from the assistant projection and keep all quantitative and payer facts server-side.
3. Risk: a malformed or foreign URL removes the pause notice.
   Mitigation: keep the canonical pause notice unchanged unless a current first-party link validates.
4. Risk: a private funding-page sponsor lookup fails after the recovery URL is available.
   Mitigation: keep the delivery-critical recovery projection separate from the page-only sponsorship projection.
5. Risk: a refill already bound to its payment intent settles after its authorization is paused or canceled.
   Mitigation: treat an unresolved current-period payment as available recovery before testing whether a new refill may be admitted.
6. Risk: any remaining exhaustion projection failure falls back to linkless copy and consumes the one capacity epoch.
   Mitigation: make the link mandatory, preflight its configured origin and signing authority before production serves traffic, and fail before claim/provider work instead of returning fallback copy.

## Tasks

1. Add a server-owned read of whether automatic group recovery is available.
2. Reduce assistant-facing usage state to urgency plus the first-party funding capability.
3. Remove sponsored-specific low-usage and exhaustion branches.
4. Update focused unit, prompt-contract, and real-model scenarios.
5. Align architecture, product, deployment, and package documentation.
6. Run focused verification, completion review gates, exact-head CI, and update the PR.

## Decisions

- “Ask for sponsorship again” uses the existing group funding ask and funding page; this change does not add multiple concurrent monthly sponsors.
- Exhaustion always exposes the current funding link even if an automatic refill is pending, because the group is already paused.
- Exhaustion uses one deterministic neutral message: Murph is paused, the link contains private ways to add time, and the room may instead wait for reset. The rotating payer-pressure corpus is deleted.
- Referral source access is an access decision, not a funding decision, so it uses the runtime access owner directly.
- The assistant treats `fundingNeeded: false` as a command to stay quiet and does not infer why.

## Review remediation

- Separate the public recovery projection from private funding-page sponsor state so sponsor-read failures cannot remove the exhausted-room link.
- Check current-period pending refills before reusable payment authority, including already-bound payments on paused, recovery-required, or canceled authorizations.
- Delete randomized exhaustion funding prompts and their template machinery.
- Remove group funding reads from referral eligibility.
- Add direct privacy, pending-state, deterministic-copy, and prompt-contract coverage.
- Validate delivery against the configured hosted origin, and extend the existing production predeploy guard to construct and parse the same signed funding-only URL before serving traffic.
- Keep an authenticated signed locator inside the funding-only path, and match an authorized group purchase by its already-resolved beneficiary runtime member so alternate valid funding locators do not become billing identities.

## Review anomaly retrospective

- Original requirement: an exhausted room gets one pause notice with a usable first-party recovery link.
- First-reviewed authored-source churn was 407 lines; the first remediation head reached 538. The added shape came from the public/private projection split and pending-refill coverage, while the pressure-copy corpus and referral over-read were deleted.
- Repeated mechanism: removing the private sponsor read did not remove every fallible dependency before the one-shot notice claim; a null or caught projection could still send linkless copy.
- Decision: the link is mandatory. The delivery projector uses only the runtime member ID, configured first-party origin, and signing key. Capacity and exact-route authority remain with the existing claim owner; sponsor state, join-code preference, display data, and billing state are not delivery prerequisites.
- Failure disposition: production predeploy must prove the configured HTTPS origin and signing authority can construct and parse the mandatory URL. Runtime projection validates against that same origin and fails before Linq or Telegram claim/provider work rather than sending terminal linkless copy. A completed crossing has no separate replay owner, so the pre-serve invariant—not a claimed retry—is what prevents this configuration dead end.
- Purchase-target disposition: exhaustion remains database-free and may carry a signed locator for any room. After that locator authenticates, the funding page keeps it in every browser endpoint and return URL instead of exposing an owner-created enrollment code. Downstream group purchase matching uses the exact resolved beneficiary runtime member; payer, purchase kind, offer, request key, and Family identity checks remain unchanged.
- Architecture disposition: continue with the existing owners and no new state, queue, scheduler, replay lifecycle, or notification system.

## Verification

- Focused Web proof passed: 554 tests covering refill availability, public/private projection, assistant serialization, deterministic linked exhaustion delivery, both provider routes, and funding-locator purchase recovery.
- Focused Assistant Engine proof passed: 13 static prompt-contract tests. Web and Assistant Engine typechecks and focused lint passed.
- The existing design-catalog funding surface passed desktop and mobile visual proof with a synthetic signed funding endpoint.
- Final ReviewGPT round 6 passed the behavior head with no remaining qualifying finding. The later exact-head catalog-only proof delta did not change production behavior.
- Exact-head GitHub Actions passed, including release build/typecheck, app verification, package coverage, frontend design proof, and the production-shaped hosted-local Stripe browser matrix.
Completed: 2026-08-07
