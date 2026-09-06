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
