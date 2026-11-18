# Bound media work during inbox capture

Status: completed

An inbox capture already carries its canonical attachment record. Use that record
to select the files for receipt publication. Preserve the existing expiry rules,
including raw references from older event revisions, and replay the acknowledged
receipt after loss of the local workspace.

Verify that capturing media leaves unrelated files for snapshot reconciliation.
Compare the same synthetic receipt with a small and a large event ledger.

The receipt selects its own capture. Existing ledger shards still supply historical
raw-path references, including earlier revisions. Raw-path matching avoids typed
event validation and latest-revision selection for this operation. The snapshot
continues to reconcile the whole workspace.

Five runtime suites passed (270 cases), including recovery of image and video
receipts. The previous publisher failed four upload-scope assertions. The
runtime typecheck and diff complexity check passed. On the local synthetic
image fixture, eleven alternating measured runs per implementation gave a
median receipt publication time of 36.3 ms before and 11.8 ms after with 12,000
unrelated events. The small fixture measured 2.1 ms and 1.9 ms.
Updated: 2026-11-18
Completed: 2026-11-18
