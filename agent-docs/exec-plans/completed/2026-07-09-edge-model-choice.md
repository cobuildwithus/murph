# Edge Model Choice

Status: completed
Updated: 2026-07-09

## Goal

Let an active Edge member opt into GPT-5.6 Sol from Settings while every
member, including Edge members who do nothing, continues to use the platform
default GPT-5.6 Terra.

Success criteria:

- Only an active, unsuspended Edge member can save the Sol opt-in.
- Terra is represented by the absence of an override so platform model changes
  and emergency rollbacks remain authoritative.
- The selected effective model reaches the hosted assistant when its next
  hosted invocation begins through the existing signed workspace read. An
  already-active invocation may retain its bounded snapshot until the current
  180-second idle window closes.
- Leaving Edge makes Terra effective at the next hosted invocation boundary. A
  later Edge reactivation may restore the member's earlier explicit Sol choice.
- Settings exposes a small, accessible control with clear pending, success, and
  error states.
- Focused tests, full acceptance verification, required audits, PR review, and
  CI pass before handoff.

## Constraints

- Reuse the existing signed workspace-read control plane that already runs
  before each hosted invocation. Do not create a second callback or duplicate
  model truth into a vault, snapshot, mailbox, or operator profile.
- Store only the member's Sol opt-in. Do not persist Terra as a competing source
  of truth.
- Preserve the platform-owned hosted assistant profile as the rollback floor.
- Keep billing eligibility derived from canonical member billing state.
- Do not weaken auth, suspension, billing, usage accounting, or deploy
  invariants.
- Preserve unrelated work in the primary checkout and active coordination
  lanes.

## Current State

- Hosted execution and usage accounting already support both GPT-5.6 Terra and
  GPT-5.6 Sol.
- Production currently seeds a platform-owned GPT-5.6 Terra profile from the
  hosted runtime environment.
- Hosted members already have persisted tone and voice preferences, but those
  are canonical vault presentation choices and are not an appropriate owner
  for operational model routing.
- Every runner invocation already fetches a signed, member-bound workspace
  response from web before constructing the trusted runner environment.
- The inline Settings control is implemented with explicit save, pending,
  success, and stale-entitlement error states; its focused interaction tests
  pass.

## Plan

1. Define the two supported hosted model choices and the single Edge
   eligibility resolver.
2. Add a nullable hosted-member Sol opt-in, include its effective value in the
   settings snapshot, and gate the mutation by active Edge entitlement.
3. Add the optional override to the existing signed workspace response and let
   the runner apply it only while the fleet default is Terra, preserving global
   rollback authority.
4. Add the inline Settings model control and verify its rendered structure,
   interaction states, and responsive-compatible use of the existing Settings
   layout.
5. Run focused tests, Prisma generation, full acceptance verification,
   security/privacy, frontend, coverage-write, and final review gates.
6. Finish the scoped commit, open the PR, resolve ReviewGPT findings, and wait
   for green CI.

## Verification

- PASS focused Settings model-control, Settings-page, preference, billing,
  mutation-route, workspace-contract, and hosted-runtime tests.
- PASS Prisma client generation and schema/type validation.
- PASS static frontend review, server-rendered Settings verification, and
  interaction/accessibility tests. The in-app browser backend was unavailable,
  so visual desktop/mobile screenshots could not be captured.
- PASS low-concurrency `pnpm verify:acceptance` (workspace checks plus full web
  and Cloudflare verification).
- PASS required security/privacy, frontend, coverage-write, and final fixture
  audits with no accepted medium-or-higher findings.
- PENDING scoped commit, PR, ReviewGPT, and final CI gate.

## Deployment

- Deploy the nullable database migration first, then the Cloudflare consumer,
  then the web producer and Settings control.
- An old web response omits the optional override, so the new consumer keeps
  the fleet default. An old consumer ignores the new response field, so a
  web-first deploy is safe but a saved choice would be temporarily ineffective.

## Open Questions

- None. The existing primitives support the requested behavior without a new
  service or background queue.
Completed: 2026-07-09
