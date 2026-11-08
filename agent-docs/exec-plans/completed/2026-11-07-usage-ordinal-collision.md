# Share the turn usage ordinal owner

Status: completed
Created: 2026-11-07
Updated: 2026-11-07

## Goal and scope

Prevent distinct streamed child, primary, and returned-tool usage from receiving
the same immutable usage identity. Local producer correction only; no ledger,
schema, settlement guard, production repair, or deployment changes.

## Protected contracts and decisions

- Keep the original turn identity, attempt count, accepted inputs, and attribution.
- Reserve primary usage before provider execution, then pass the foreground
  service's existing ordinal allocator to the runner's streamed-usage callback.
- Returned drafts keep their existing foreground remapping. Notification and Ask
  continuation remain single-request consumers of provider-local ordinals.
- Child completion is fenced once by the provider adapter. Late reports retain
  the originating callback and share the same turn-local counter.
- No new persisted state, synthetic turn identities, or retry owner.

## Product walkthrough

Outcome: Restore distinct accounting identities so this collision cannot block
later group responses through pending settlement.
Reaches: Group reconsideration, early and late children, returned tools, failed
provider turns, and unchanged single-request notification/Ask accounting.
Proof: Synthetic producer and recording-seam regressions plus existing owner tests.
Local accounting proof is Ready after checks; production recovery remains Hold
until an independently authorized rollout and operational verification.

## Reproduction

The runner streams terminal child usages immediately, excluding them from the
returned additionalUsages list. Foreground then remaps only the returned records
with a separate counter. Synthetic execution produced five records with ordinals
[1, 0, 2, 2, 1], reusing two immutable IDs for distinct provider requests. The
held-group fixture also failed its shared-counter assertion before the fix.

## Verification

- Red: streamed child recording tests fail for successful and failed reconsideration.
- Red: held-group test misses the streamed ordinal reservation.
- Green: all three targeted tests pass after the producer correction.
- Passed: assistant-engine typecheck.
- Passed: full runner, foreground live-input, and usage-seam files, 149 tests.
- Passed: streamed-usage and provider subagent event selections, 49 tests including
  successful/failed reconsideration, late children, and standalone fallback.
- Passed: final assistant-engine typecheck, complexity diff (no added debt),
  diff whitespace check, docs drift and gardening.
- Parent reviewed the shared-owner source correction without additional findings.
- Model behavior and prompts are unchanged; deterministic accounting proof is the
  relevant local boundary, not an extra paid live-model run.
- No production mutation, live model call, external review, push, or deploy performed.

## Completion

The parent owns review, publication, any required final external review, and rollout.
No release-note entry: this is internal accounting identity repair without a new
member-facing feature or changed communication behavior.
Completed: 2026-11-07
