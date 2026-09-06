# Compress closed ledger months with native Brotli

## Outcome

After the compatible-reader release deploys and drains, use quality-5 Brotli for
closed event and integration-ingest months. Convert existing gzip shards through
the existing idle archive pass. Preserve exact uncompressed bytes, receipts, row
validation, source-change checks, atomic publication and foreground aborts.

## Design

The filesystem remains the worklist. No marker, job, queue or new service. Current
and future UTC months remain untouched. Resume raw/gzip/Brotli duplicates only
when every representation validates and has the same complete content receipt.
Keep the query SQLite and the outer snapshot codec unchanged.

## Verification

Pending focused archive, idle interruption, snapshot/restore tests, core typecheck,
complexity guard, required CI and final review.

## Local evidence

- Core archive suites: 60 tests passed; final migration/error-classification probe
  rerun (13 passed) and event regressions rerun (22 across two files).
- Idle maintenance: 39 tests passed, including foreground wake interruption.
- Encrypted snapshot local suite: 23 tests passed, including smaller snapshots
  and logical event reads after restore.
- Core and Cloudflare typechecks passed. Complexity guard passed; no new debt.
  Existing novelty scan hotspots remain unchanged. Event maintenance is 20 after
  consolidating result handling; validation stays with the two storage owners.
- A composite Cloudflare package test unexpectedly ran 158 files while edits
  continued: 157 passed, one runner-artifact test failed with a stale source
  fingerprint. The focused snapshot command passed. Friction is recorded locally;
  frozen-source runner-artifact proof is pending.
- The reader PR owns shared write-policy suffixes and export conflict recognition.
  This PR is stacked on that reader and must deploy only after it drains.
- Required CI and final ReviewGPT pending.
