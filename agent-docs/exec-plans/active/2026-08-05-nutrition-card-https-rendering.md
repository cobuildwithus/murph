# Nutrition card HTTPS rendering correction

Status: active
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Make daily nutrition response cards render visibly in iMessage through Linq's
  documented static app-card contract.
- Preserve the existing single outbox effect, deterministic text fallback, and
  partial-total semantics without adding another state or rendering owner.

## Root-cause proof

- The response-card tool completed and the outbox retained one card-bearing
  delivery intent.
- Linq accepted the request and later reported a delivered iMessage, but the
  physical transcript did not show the card.
- The shipped request used an inline `data:` URL. Linq's app-card contract
  requires the `url` field to be HTTPS even when `interactive` is false.
- The configured Messages extension identity matches the shipping extension,
  which rules out identity fallback as the remaining contract violation.

## Success criteria

- The Linq app-card request uses a fixed, non-sensitive HTTPS URL.
- The noninteractive static layout contains the card's date, meal count,
  available nutrition totals, and an explicit marker when any total is partial.
- A V2 layout preserves the first available exact goal and frozen status in
  canonical metric order instead of making goal-resolution work invisible.
- The fallback text remains short and value-free so Apple data detection cannot
  downgrade the app-card presentation.
- Empty assistant text still preserves the singular card delivery.
- Focused tests prove the exact provider payload and both complete and partial
  layouts.

## Constraints

- Do not persist card contents in a second location or introduce a card-serving
  API, extension network read, additional provider call, or new dependency.
- Retain V1 parsing and deterministic text for existing outbox and fallback
  behavior.
- Keep health values only in the existing outbound provider payload and do not
  place production evidence in durable artifacts.

## Tasks

1. [x] Capture post-deploy evidence and prove the provider-payload boundary.
2. [x] Replace the inline URL with the HTTPS static-card contract.
3. [x] Add exact payload and layout regression coverage.
4. [x] Update architecture, reliability, and deliverability ownership docs.
5. [x] Run focused verification and inspect the candidate diff.
6. [ ] Complete PR review gates, merge, deploy, and verify on a physical device.

## Verification log

- The operator-config focused suite passed with 55 tests across the response
  card and exact Linq request-body owners.
- The operator-config package typecheck passed.
- Three focused assistant-engine regressions passed for empty-text card
  preservation, single outbox ownership, and capability-gated Linq delivery.
- The fixed product URL returned HTTP 200 over HTTPS without carrying card or
  member state.
- The candidate diff passes `git diff --check`, and stale inline-URL encoder
  references are absent from the active implementation and owner docs.
- The preliminary specialist review identified lost goal/status presentation,
  misleading degraded-state copy, and an unproved unavailable-metric branch.
  The corrected layout retains one exact goal/status, the fallback names a real
  text-recovery action, and the accepted coverage patch adds the missing branch
  proof. Physical transcript rendering remains the explicit post-deploy gate.
- Final ReviewGPT round 1 recommended deleting goal-resolution work because the
  first reviewed layout did not consume it. That remedy was rejected against
  the shipped goal-aware product promise; the corrected layout instead makes
  the first canonical available goal and status observable without adding an
  owner. A correction-delta review is pending.
