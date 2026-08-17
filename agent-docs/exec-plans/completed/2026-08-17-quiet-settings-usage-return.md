# Quiet Settings usage-credit returns

Status: completed
Created: 2026-08-17
Updated: 2026-08-17

## Goal

- Remove the transient personal and owner-seat Family "Usage added"
  confirmation from `/settings`. Successful checkout returns reconcile in the
  background and refresh the existing usage meter; only a failed or unresolved
  return opens compact recovery. Keep one close-owned compact result when the
  beneficiary meter is not present, including unavailable personal usage.

## Success criteria

- A successful personal or owner-seat Family usage-credit return never renders
  the fulfilled confirmation or messaging-channel choices on Settings.
- Another active or former Family member's exact return is owned outside the
  broader Manage dialog and shows only one close-owned compact result.
- A successful personal return with unavailable usage status shows one
  close-owned durable-credit result instead of an ungrounded quiet success.
- Failed, canceled, or unconfirmed returns retain an accessible recovery path
  with the existing safe retry/status actions.
- Group funding keeps its separately owned fulfilled contribution handoff.
- Focused component/page tests, Web typecheck, frontend design proof, and
  desktop/mobile catalog rendering pass.
- The member-visible improvement has a same-PR changelog item and completes the
  required preliminary ReviewGPT and Claude UI review gates.

## Scope

- In scope: Settings personal and Family usage-credit return presentation,
  shared top-up dialog presentation props, focused tests, design catalog,
  durable frontend docs, and changelog.
- Out of scope: Stripe reconciliation, usage-credit ledger ownership, group
  funding success UX, purchase eligibility, and checkout creation.

## Constraints

- Technical constraints: preserve the existing bounded client reconciliation
  and router refresh; do not add state, a new endpoint, or a second payment
  owner.
- Product/process constraints: default to deletion, preserve error recovery,
  keep the production component represented on `/design`, and use the
  worktree/PR completion lane.

## Risks and mitigations

1. Risk: Hiding the dialog also prevents its status poll.
   Mitigation: keep controller state active while controlling only whether the
   dialog is presented.
2. Risk: The shared dialog change alters group funding success.
   Mitigation: activate quiet return behavior only for Settings personal and
   Family callers; retain the group-only Messages handoff and cover it in the
   focused suite.
3. Risk: An active Family member's return has no mounted controller after the
   payer lands back on the closed roster.
   Mitigation: mount one exact status owner independently of Manage and keep
   all plan and purchase controls inside Manage.
4. Risk: a conditionally inserted populated live region is not announced.
   Mitigation: mount the empty polite status owner before reconciliation and
   update that same node only after verified fulfillment.
5. Risk: quiet fulfillment also hides the only visible result when no meter is
   rendered, or leaves the next Add usage action suppressed after refresh.
   Mitigation: derive quiet presentation from the meter-owning branch, keep the
   unavailable branch close-owned, and close the fulfilled hidden controller so
   its existing trigger can reset to selection.
6. Risk: applying return-only quiet presentation to a sessionless saved-card
   purchase inside Family Manage hides the only visible result and immediately
   permits a repeat charge.
   Mitigation: keep the nested Manage caller on the existing visible fulfilled
   state; only the independently mounted owner-return surface may defer to the
   visible Settings meter.

## Tasks

1. Add a Settings-only quiet successful-return presentation mode to the shared
   top-up dialog and delete personal/Family contact-option plumbing.
2. Update focused dialog, Settings, billing, and Family tests plus the design
   catalog study.
3. Update durable frontend documentation and add a public changelog item.
4. Run focused verification, rendered proof, review gates, CI, and parent final
   review; close the plan with the final scoped commit.

## Decisions

- Keep background reconciliation in the existing hook. Hiding the controlled
  dialog must not change the payment or polling state machine.
- Show the existing recovery surface only when a successful return fails,
  reaches a non-success terminal state, or remains unresolved after the bounded
  poll.
- Remove personal and Family post-purchase messaging options entirely. They do
  not advance the payment outcome and caused the oversized transient modal.
- Keep off-meter Family return ownership distinct from the Manage dialog. The
  roster supplies the member label, while the existing top-up controller still
  owns polling, query cleanup, compact result presentation, and close refresh.
- Treat unavailable personal usage as off-meter: confirm durable account credit
  without claiming current availability and refresh only after Close.
- Keep a Family saved-card purchase initiated inside Manage visible through
  verified fulfillment and dismissal. Quiet presentation belongs only to the
  independently mounted checkout-return owner beside the visible meter.

## Verification

- Commands to run: focused hosted usage top-up, billing, Family, and Settings
  Vitest files; Web scoped typecheck; `pnpm test:frontend-design-proof`;
  desktop/mobile Playwright catalog capture; `git diff --check`.
- Expected outcomes: success remains visually quiet only beside a rendered
  beneficiary meter; off-meter fulfillment stays visible until Close; failed or
  unresolved returns expose recovery; group success is unchanged; all focused
  checks pass.
Completed: 2026-08-17
