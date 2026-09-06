# Read Brotli ledger archives through existing storage owners

## Outcome

Prepare every canonical event and integration-ingest reader, amendment and query source classifier for lossless `.jsonl.br` archives. Keep new closed-month publication on gzip until this reader release has deployed and drained. Reuse native Node codecs and existing limits, receipts, locks and atomic publication.

## Scope

- One small shared codec module for the two existing ledger owners.
- Logical paths and append receipts remain representation-neutral.
- Preserve gzip and legacy integration ZIP reads; reject ambiguous representations.
- Exercise malformed/truncated archives, bounded decode, late amendments, query discovery and exports through existing owner APIs.
- Follow with writer activation and idle gzip conversion in a separate PR.

## Verification

Pending focused core/query tests, typechecks, complexity guard, CI and final review.

## Codec decision

Use native Brotli at quality 5. Synthetic corruption testing reproduced silent
truncated-frame acceptance in the supported Node Zstandard decoder. Brotli rejects
truncation without a custom framing validator or another dependency. Private-vault
measurements were inspected only in memory; no source data or identifiers are
included in this change. Keep the existing outer snapshot compression and query DB.

## Local evidence

- Core ledger suites: 52 tests passed; quality-5 codec regressions rerun and passed.
- Query source manifest: 8 tests passed, including Brotli discovery and reads.
- Core and query typechecks passed.
- Complexity guard passed. Existing integration novelty scan hotspots (32, 27,
  24) retain their prior complexity and behavior; only archive dispatch changes.
- No dependency, wire receipt, query schema or provider-input changes.
- Required CI and final review pending.

## Canonical writer and export follow-through

The full write-batch rollback probe exposed a separate archive suffix list in the
write-policy owner. Export and reuse that list in the ingest reader, including
Brotli, so generic writes and canonical archived amendments agree. The probe now
passes without creating a raw sibling. Standalone data-bundle conflict detection
also recognizes Brotli; a synthetic export retained exact archive bytes and rejected
an ambiguous raw/Brotli pair. Core typecheck, codec tests, complexity and shell syntax
checks passed again. The first external review was already running on the prior
head; a follow-up review is required for this production delta.

## Round 1 disposition

ReviewGPT reviewed the original head and reported one High finding: the generic
write-policy suffix list omitted Brotli, so a canonical amendment could create a
raw sibling and break rollback. The finding is valid for that historical head and
already corrected by commit 3334253fe954 before response capture. Current-head
source rejects this failure path by sharing the archive suffix list, and the real
write-batch rollback regression passes. No additional production remediation is
accepted from this result. Remaining corrections are review evidence and the
isolated frozen-layout documentation expectation, so the non-production disposition
exception applies. Round 2 will review the full current patch including the fix.

CI's only platform-b failure was the frozen-layout test expecting the old documented
suffix display. Align that isolated expectation with the Brotli-capable doc. No
runtime contract or generated registry changes are required.
