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

- The WHOOP admission owner reserves two provider-side accounts that are not in
  the connection graph and allows at most 98 tracked active members across
  direct WHOOP and Junction-backed WHOOP connections.
- Existing WHOOP members can still reconnect when the shared allowance is full.
- A successful WHOOP callback still opens the existing completion dialog and
  its unchanged App Store and Apple Health setup guide.
- A new member after the 98 tracked slots are full still receives the existing
  Apple Health fallback rather than a failed or misleading OAuth handoff.
- Focused tests, hosted-Web typecheck, exact-head CI, and the required
  cross-cutting review gate pass.

## Scope

- In scope: WHOOP capacity policy, focused boundary/route tests, verification
  that the existing post-connect guide remains intact, and one member-facing
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

- Outcome: New WHOOP members can authorize direct sync again without changing
  the existing post-connect experience.
- Reaches: The existing signed-in `/connect` WHOOP start and capacity-full
  fallback journeys.
- Proof: Focused capacity and route tests plus direct comparison of the
  completion/setup-guide owners against `main`.

## Risks and mitigations

1. Risk: Raising the gate accidentally changes the post-connect Apple Health
   guidance.
   Mitigation: Leave the completion/setup-guide owners byte-for-byte identical
   to `main` and retain their existing tests.
2. Risk: The larger count broadens an unbounded database read.
   Mitigation: Preserve the current per-branch and final SQL limits and update
   their exact bound to the 98 tracked-member allowance.
3. Risk: The limit changes but `/connect` still chooses the fallback before the
   98th tracked slot.
   Mitigation: Exercise the real route owner at 97 and 98 active members.

## Tasks

1. Characterize the current `/connect`, capacity, and completion flows and
   confirm current official WHOOP data availability.
2. Raise the WHOOP provider allowance to 100, reserve the two provider-side
   accounts absent from the database, and update exact-bound tests.
3. Verify the existing post-connect App Store and Apple Health guide remains
   intact, without changing its copy or design representation.
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
- Reconcile the provider dashboard's 8 used slots with the 6 tracked active
  members by reserving the two-account gap in the existing capacity owner.

## Verification

- Commands to run: focused Vitest files for capacity, route interaction, and
  unchanged completion behavior; hosted-Web typecheck; `pnpm complexity:diff`;
  exact PR-head CI; ReviewGPT.
- Expected outcomes: 97 tracked members admits the next OAuth start, 98 blocks
  only a new member, existing members remain admitted, and successful
  completion retains the existing Apple Health/App Store handoff.
