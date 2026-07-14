# WHOOP spot HRV daily retention

## Goal

Bound direct WHOOP spot-RMSSD ingestion to one live canonical observation per
vault-local day and capture method without weakening exact retry, consent,
privacy, or hosted acknowledgement guarantees.

Success criteria:

- Stable daily identity prevents separate same-day captures from minting
  unbounded live observations.
- The first reading in a quality tier wins; a good reading may upgrade a
  limited reading, and all other same-day captures are canonical no-ops.
- Non-winning captures retain no canonical evidence or ingest receipt.
- Exact replays and vault-timezone replay keep their existing behavior.
- WHOOP spot RMSSD remains distinct in provenance and grain from overnight
  WHOOP/Oura summaries and Apple Health SDNN.
- The iOS capture UI offers a same-session retry only for limited signal and
  explains the daily retention rule.

## Constraints

- Never persist or transmit raw BLE packets, pulse intervals, device
  identifiers, or interval timestamps.
- Preserve the existing 60-second `rmssd-pulse-interval-v1` contract; this is
  not a generic arbitrary-window aggregation endpoint.
- Reuse canonical event reconciliation and evidence ownership. Add no queue,
  scheduler, database table, or lifecycle owner.
- Preserve unrelated worktree and coordination-ledger edits.

## Approach

1. Add a narrow generic external-reference policy that accepts only a higher
   origin-confidence revision and otherwise keeps the existing canonical
   event.
2. Exclude evidence tied only to policy-rejected events before novelty and
   persistence checks.
3. Give WHOOP spot RMSSD a method-and-vault-day external identity, with the
   admission identity retained as a legacy replay alias.
4. Add importer/core regression coverage for limited-to-good upgrade, bounded
   physical revisions, rejected evidence, exact replay, and next-day capture.
5. Update the iOS result state, tests, and product spec so only limited signal
   offers an immediate quality retry.
6. Run focused and required verification, completion audits, CI, and
   ReviewGPT for the backend follow-up PR.

## State

Implementation and local verification complete. The canonical importer now
uses one method-and-vault-day identity, accepts only a higher-confidence
revision, and drops rejected-only evidence and receipts. The iOS PR exposes
one same-session quality retry only after a limited reading.

Verification completed:

- Core and importer typechecks.
- Focused core validation/device-import suites (145 tests).
- Focused Junction importer suite (138 tests), including late downgrade and
  rejected-receipt coverage.
- Scenario integrity (204 scenarios, 11 inputs, 28 goldens).
- Core and importer package coverage suites.
- Documentation drift and diff checks.
- Coverage-write and security/privacy completion audits; no unresolved
  findings.

The repository-wide diff selector reached an unrelated fresh-worktree
reverse-dependent typecheck failure because generated workspace package
outputs were absent. The owning core/importer typechecks and package coverage
suites are the documented scoped fallback.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
Completed: 2026-07-14
