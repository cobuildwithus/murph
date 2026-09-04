# Restore WHOOP OAuth capacity and preserve Apple Health steps handoff

Status: active
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Let eligible signed-in members start the existing WHOOP OAuth flow from
  `/connect` until the provider's new 100-member allowance is full, while
  preserving the post-connect Apple Health handoff that fills WHOOP's missing
  step data.

## Success criteria

- The WHOOP admission owner allows at most 100 distinct active members across
  direct WHOOP and Junction-backed WHOOP connections.
- Existing WHOOP members can still reconnect when the shared allowance is full.
- A successful WHOOP callback still opens the existing completion dialog and
  its App Store setup guide, now explicitly explaining that WHOOP OAuth does not
  provide steps and Apple Health supplies them.
- The 101st new member still receives the existing Apple Health fallback rather
  than a failed or misleading OAuth handoff.
- Focused tests, hosted-Web typecheck, rendered phone/desktop proof, exact-head
  CI, and the required cross-cutting review gate pass.

## Scope

- In scope: WHOOP capacity policy, WHOOP completion/setup-guide copy, the
  existing design-catalog representation, focused tests, and one member-facing
  changelog item.
- Out of scope: provider credentials, OAuth scopes/endpoints, stored connection
  state, Apple Health ingestion, device-sync scheduling, and deployment or
  production configuration changes.

## Constraints

- Technical constraints: keep the existing server-owned capacity check and
  direct OAuth route; count distinct active members across both WHOOP connection
  representations without adding state or another owner.
- Product/process constraints: treat this as a Product UX Patch that restores
  an existing journey; preserve the truthful fallback at capacity and the
  existing post-connect recovery path.

### Product UX Patch

- Outcome: New WHOOP members can authorize direct sync again, then receive one
  clear next step for importing step data through Apple Health.
- Reaches: The existing signed-in `/connect` WHOOP start, successful callback,
  and capacity-full fallback journeys.
- Proof: Focused capacity and completion tests plus the existing
  `/design?tab=components#whoop-completion-dialog` representation at phone and
  desktop widths.

## Risks and mitigations

1. Risk: Raising the gate accidentally bypasses the post-connect Apple Health
   guidance.
   Mitigation: Keep callback completion independent of the capacity error and
   assert the steps-specific setup guide on successful WHOOP completion.
2. Risk: The larger count broadens an unbounded database read.
   Mitigation: Preserve the current per-branch and final SQL limits and update
   their exact bound to 100.
3. Risk: Copy overstates what either provider shares.
   Mitigation: Bound the claim to the current WHOOP developer API, which exposes
   recovery, cycle, workout, sleep, profile, and body-measurement scopes but no
   steps endpoint; WHOOP documents exporting steps through Apple Health.

## Tasks

1. Characterize the current `/connect`, capacity, and completion flows and
   confirm current official WHOOP data availability.
2. Raise the existing WHOOP member limit to 100 and update exact-bound tests.
3. Make the preserved post-connect guide explicitly explain the steps gap, then
   align the design representation and focused assertions.
4. Add the member-visible changelog item, run focused tests/typecheck/rendered
   proof, review the final diff, close the plan, commit, and open the draft PR.
5. Push the exact candidate, run ReviewGPT concurrently with required CI, and
   resolve all required gates before handoff.

## Decisions

- Reuse the current direct WHOOP OAuth route and capacity owner; the prior
  product shutdown was solely the two-member constant.
- Preserve the same Apple Health setup guide for both successful WHOOP
  completion and the eventual capacity-full fallback.
- Do not change OAuth scopes or provider configuration because the WHOOP API's
  current documented OAuth surface still has no steps scope or endpoint.

## Verification

- Commands to run: focused Vitest files for capacity, connect-page interaction,
  and completion; hosted-Web typecheck; `pnpm complexity:diff`; a task-scoped
  Playwright capture of the existing design state at phone and desktop; exact
  PR-head CI; ReviewGPT.
- Expected outcomes: 99 current members admits the next OAuth start, 100 blocks
  only a new member, existing members remain admitted, successful completion
  renders the steps-specific Apple Health/App Store handoff, and the design
  state remains usable at both viewports.
