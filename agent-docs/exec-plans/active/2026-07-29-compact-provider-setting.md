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

- Focused component tests cover opening, choosing, cancelling, saving, stale
  availability, and read-only behavior.
- The real production settings component and provider picker appear in the
  design catalog with desktop and mobile rendered evidence.
- Focused Web typecheck and frontend design-proof checks.
- Product-experience review, preliminary completion-specialists ReviewGPT,
  Claude UI double-check, parent review, and exact-head required CI.

## Progress

- [x] Confirmed the existing settings surface and save-state ownership.
- [x] Replace provider cards with the compact provider row and dialog.
- [x] Update focused tests and design-catalog studies.
- [ ] Capture desktop/mobile proof and complete required reviews.
- [ ] Push a scoped PR, resolve review findings, merge, and retire the worktree.

Status: active
Updated: 2026-07-29
