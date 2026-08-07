# Unified group funding contract

Status: active
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
   Mitigation: retain the ordinary pause sentence and append a link only after first-party validation.

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

## Verification

- Commands to run: focused Web tests; focused Assistant Engine prompt tests; Web and Assistant Engine typechecks; focused lint; required documentation checks; ReviewGPT specialist and final gates; exact-head GitHub Actions.
- Expected outcomes: all focused checks and required PR gates pass with no sponsored-specific assistant branch remaining.
