# Recover incomplete device-sync snapshot reads within the existing deadline

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Recover a transient, proven incomplete snapshot response without waiting for the next durable job pass or adding Worker body buffering.

## Product UX

- Outcome: connected-device work can continue after a transient incomplete internal state read.
- Reaches: snapshot reads in the existing hosted device-sync consumer; existing auth, provider requests and durable retry ownership remain intact.
- Proof: transient empty/partial response followed by valid state; persistent failure; cancellation/deadline; authorization rejection; valid and legacy response acceptance. Patch effort, no UI or assistant-prompt change.

## Scope and decisions

- Extend the existing consumer byte-count/error classifier and exact single-replay owner; no additional retry loop or Worker stream manipulation.
- Reclassify only an already rejected empty or invalid-JSON snapshot with a valid expected count strictly exceeding streamed bytes. Preserve valid response acceptance and missing/invalid diagnostic marker compatibility.
- At most two Web attempts within the original total timeout. Persistent failures return to the existing durable retry owner.
- Production patch is authored by ReviewGPT. Parent owns evidence, review, documentation/changelog and PR completion.
- Treat upstream workerd behavior as a reproduced possible mechanism, not a proven initiating production cause. This change is bounded recovery.

## Risks

- A replay adds a Web read and can use more of the existing deadline. Prove request count, deadline and cancellation rather than extending budgets.
- Diagnostic metadata must not become an auth/integrity gate for successful JSON. Cover valid mismatched markers and old producers.
- Shared transport changes must not broaden retry for non-snapshot routes or application/schema errors.
- No raw bodies, identifiers, raw headers, new correlation fields or private production records in logs or fixtures.

## Tasks

1. Complete: clean owned branch based on current inspected main; exact ReviewGPT-authored patch applied.
2. Complete: focused proof, typecheck, complexity and parent review pass; member recovery note included.
3. Draft PR opened with the failing reproduction. Candidate implementation and plan closure are ready for the scoped final commit.
4. PR-owned external gates: start final ReviewGPT concurrently with exact-head CI after this stable candidate is pushed. Those results remain pending at plan archival; do not infer merge/deployment approval.

## Verification

- Red proof: six real-HTTP cases fail on unchanged production source across empty/partial identity, gzip and Brotli responses. They require the actual snapshot port to recover within one call and preserve the exact request body.
- Documentation drift and gardening checks passed after updating the reliability index entry.
- Exact production author patch applied and production postimages verified against its declared hashes.
- Passed: 355 focused Cloudflare tests across snapshot replay, raw HTTP recovery, signed snapshot diagnostics and runner-platform regression coverage.
- Passed: Cloudflare typecheck; complexity debt remains 20 and maximum remains 40, both unchanged. Existing request-attempt hotspot reviewed; it was not modified.
- Passed: ten changelog archive rendering tests; current production presentation reference returns HTTP 200 and contains the archive anchor.
- Parent review: classification only reuses existing diagnostic counts for already-invalid short snapshots; successful JSON acceptance and legacy markers are preserved. No new Worker buffering, encoding handling, request-loop owner, auth or provider behavior.
- Product UX: Ready for PR review. Transient failures recover inside one call; persistent errors stop after two attempts; deadline and caller cancellation remain authoritative. Exact-head CI and final ReviewGPT are separate pending PR gates.
- Scope exclusions: no new live production observation, provider replay, release or claimed repair of the initiating network interruption.
Completed: 2026-09-10
