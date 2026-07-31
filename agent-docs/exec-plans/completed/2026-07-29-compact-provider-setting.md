# Compact Provider Setting

## Outcome

The assistant model setting keeps Luna, Terra, and Sol as the primary choices.
When Venice is available, one quiet line beneath the model choices names the
draft inference provider and a ghost `Change` button opens a focused provider
selection dialog.

## Invariants

- The existing Web-owned provider preference and save endpoint remain the only
  data owner and mutation path.
- Provider changes remain draft form state until the member submits the
  existing `Save change` action.
- OpenAI remains the fail-closed fallback when Venice becomes unavailable.
- Read-only members can inspect the current provider but cannot open or change
  the provider choice.
- The dialog uses the same OpenAI and Venice options without adding persisted
  state, APIs, dependencies, or runtime behavior.

## Proof

- Focused component tests cover opening, choosing, dismissing, cancelling,
  saving, stale availability, and read-only behavior: 18 tests passed.
- The real production settings component and provider picker appear in the
  design catalog with desktop and mobile rendered evidence.
- The exact-head production Web artifact kept the dialog contained and
  internally scrollable at 844×390 and 844×320 with 125% text sizing; keyboard
  selection and Escape both restored focus to the `Change` trigger.
- Focused Web typecheck, targeted ESLint, diff checks, and the frontend
  design-proof gate passed.
- Product-experience review returned `NO FINDINGS`.
- Preliminary completion-specialists ReviewGPT returned two findings. The
  accepted short-viewport containment and dismissal/cancellation coverage
  findings were resolved and reverified.
- The separate Claude UI check was attempted and stopped after explicit credit
  exhaustion, as required by the workflow.

## Progress

- [x] Confirmed the existing settings surface and save-state ownership.
- [x] Replace provider cards with the compact provider row and dialog.
- [x] Update focused tests and design-catalog studies.
- [x] Capture desktop/mobile proof and complete required reviews.
- [x] Push a scoped PR and resolve review findings.
- [x] Reconcile the PR candidate with the latest `main`.

Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
