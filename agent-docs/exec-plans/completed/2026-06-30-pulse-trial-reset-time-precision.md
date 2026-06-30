# Pulse Trial Reset Time Precision

## Goal

Keep the Pulse Trial reset ops path consistent with Stripe's whole-second `trial_end`
precision so billing refs and hosted AI usage periods agree immediately after a
reset.

## Scope

- `apps/web/src/lib/hosted-ops/pulse-trial-reset.ts`
- Focused Pulse Trial reset tests.

## Notes

- The production reset created the expected four current usage rows for the four
  eligible Pulse Trial candidates.
- Existing historical usage rows remain valid ledger history.
- Current reset rows match the billing ref's `current_trial_started_at`; the only
  mismatch observed was `period_end` being 169ms later than Stripe-normalized
  `current_trial_ends_at`.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
