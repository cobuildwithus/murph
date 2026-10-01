# Preserve report labels across email batches

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Goal and scope

Keep scheduled multi-metric emails available when optional host display names
differ between populated and sparse metric batches. Preserve all membership,
participant, sender-handle, projection-grant, and recipient checks. No new state,
protocol, retry, or lookup is needed.

## Cause and correction

The email aggregation owner rejected any displayName difference between batches.
Optional contact enrichment deliberately skips rows with no available data, so
the same participant can have a contact label and a pseudonym in separate reads.
The first complete host-labelled roster is already retained by the merge.
Remove only the presentation comparison and keep that complete naming snapshot.

## Verification

- Regression before correction: the valid label-only case fails with unavailable
  shared data; changed member IDs, participant IDs, and handles are rejected.
- Regression after correction: all four cases pass. The success case queues one
  actual durable email intent; authority-change cases close the capability and
  queue none. All four requested projections survive, including missing data.
- Full focused group-tool and email-outbox suite: 121 passed.
- Host-label test explicitly covers populated/sparse output with unchanged
  participant identity and grants.
- Assistant and Web typechecks, focused live email journey, and complexity are
  required before the stable remediation commit.
- External review and exact-head CI evidence remains with PR #3656.

## Outcome

- Host-label regression: 16 passed. Web and assistant typechecks passed.
- Real-Codex sparse email journey passed: one preparation, two bounded shared
  reads, and one email submission containing both correct names and values,
  explicit missing metrics, and no duplicate chat reply. Product UX: Ready.
- Complexity passed against the merge base. Existing large dynamic-tool
  functions are unchanged; the email aggregation loses one condition.
- Deploy the runtime aggregator before the Web label overlay. New runtime
  accepts both old null labels and new strings; old aggregation can reject
  differing new labels. No state migration or backfill is needed.
- Parent review accepts the single reproduced review finding as corrected by
  the existing aggregation owner. Required round-two review and new-head CI
  remain external completion gates, tracked in the PR.
Completed: 2026-09-22
