# PR 955 round 5 confirmation

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Require a signed-in member to confirm immediate Pulse billing recovered from
  a Stripe payment-method return before Murph changes billing.
- Present an active continue-at-trial-end return as a truthful receipt, and
  fail an ended or paused continue claim closed until a fresh start-now choice.
- Preserve the stateless, session-bound continuation claim and remove the
  ReviewGPT-reproduced stale-browser-return race without restoring persisted
  intent state.

## Success criteria

- A valid `start_pulse_now` claim presents exact terms and performs no POST
  until the member explicitly confirms.
- An active `continue_pulse` claim performs a mutation-free state check and
  presents a receipt without a false decline action.
- An ended or Stripe-paused `continue_pulse` claim cannot resume or create an
  invoice; its explanation remains visible until dismissal, then ordinary
  Settings requires a fresh start-now confirmation.
- A paid-at-the-boundary return shows the reconciled active plan without
  contacting Stripe or offering a nonexistent start action.
- Dismissal returns to ordinary Settings without invoking the billing service.
- Invalid, expired, copied, partial, unsigned, and marker-only returns remain
  inert.
- Focused UI and route tests, design proof, canonical diff verification,
  acceptance verification, CI, product-experience review, and final ReviewGPT
  round 5 are green.
- The PR is ready, merged, and its clean worktree retired.

## Scope

- In scope: Settings continuation presentation and client behavior, exact
  action propagation from the session claim, the timing gate in the canonical
  Pulse trial service, focused tests, design catalog study and screenshots,
  current Pulse product specs, PR evidence, and final review/merge.
- Out of scope: database or schema state, webhook reconciliation, new queues or
  background work, a second Stripe mutation path, and restoring the deleted
  persisted-intent architecture.

## Constraints

- Technical constraints: the HMAC return remains member-bound and the HttpOnly
  claim remains member/session/action-bound; the browser cannot select or alter
  the action; one explicit confirmation may issue one POST.
- Product/process constraints: disclose the billing timing before the action,
  keep cancellation non-mutating, preserve all ordinary Settings and
  product-critical billing flows, and stop at ReviewGPT round 5 unless the
  repository's explicit hard-cap continuation process authorizes another round.

## Risks and mitigations

1. Risk: the confirmation is ambiguous and the member cannot distinguish an
   immediate charge from a post-trial continuation.
   Mitigation: derive title, description, and button label from the server-read
   action and cover both branches in focused tests and the design catalog.
2. Risk: double clicks dispatch the billing mutation twice.
   Mitigation: synchronously fence the client handler with a ref in addition to
   the disabled submitting state, while retaining server idempotency.
3. Risk: dismissing only hides the component and a refresh silently revives it.
   Mitigation: remove the public return marker from browser history so the
   surviving HttpOnly claim is inert without the marked return.
4. Risk: the final UI lacks representative proof.
   Mitigation: render start-now, active-trial, paid-boundary, and ended/paused
   states in the inert design study and capture desktop and mobile screenshots.

## Tasks

1. Require fresh confirmation for start-now, and turn continue-at-trial-end
   into a mutation-free check plus truthful receipt.
2. Add focused confirmation, dismissal, inert-return, and dispatch coverage.
3. Add a design study, update current product specs, and capture browser proof.
4. Run focused and canonical verification plus the product-experience review.
5. Commit, push, update PR evidence, run CI and ReviewGPT round 5, then land the
   green exact head and retire the worktree.

## Decisions

- Keep the deletion-based architecture from ReviewGPT round 3. The browser
  return is authority to present the previously signed action, not authority to
  execute it without current user confirmation.
- A continue-at-trial-end return may automatically read current subscription
  state because that path cannot mutate Stripe. If the trial ended without
  conversion or Stripe paused it, fail closed and route the member to the
  existing start-now choice.
- Local paid state is already authoritative for the natural-conversion boundary
  and renders an active-plan receipt without another provider call.

## Verification

- Focused Settings, route, continuation, and Stripe-service Vitest: 132 tests
  passed across four files.
- `pnpm test:frontend-design-proof`: 10 tests passed.
- Canonical diff verification passed in Testbox
  `tbx_01kyeqe7dkg5n35cq15yqzb5f0`.
- Canonical acceptance verification passed in Testbox
  `tbx_01kyeqee9bde2n53fb5hr6xa7v`.
- `git diff --check` and prepared hosted-Web typechecking passed.
- The production component rendered in the design catalog at desktop and
  mobile sizes with no horizontal overflow. The mobile capture has catalog
  navigation over part of the start-now study; the three return states remain
  visible, and the clean desktop capture covers all four states.
- Product-experience review: PASS, no findings after paid-boundary and
  ended-notice remediation.
- Claude UI double-check could not rerun because the provider reported explicit
  credit exhaustion; no local substitute was added.

## Outcome

- Immediate start requires fresh consent and dispatches at most one protected
  POST.
- Active continuation is a mutation-free state check with a truthful receipt.
- Paid-at-the-boundary continuation returns the authoritative active plan
  without provider I/O.
- Ended or paused continuation cannot resume, invoice, or navigate away before
  the member acknowledges the explanation.
- Final PR-specific ReviewGPT and CI gates run against the resulting pushed
  commit before merge.
Completed: 2026-07-26
Completed: 2026-07-26
