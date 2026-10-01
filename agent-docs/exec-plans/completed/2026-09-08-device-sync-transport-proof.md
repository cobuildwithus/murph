# Diagnose device-sync transport failures

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Goal

Classify provider deadline, hosted snapshot decoding, and artifact transport failures; correct reproduced repository causes or deliver the smallest missing metadata diagnostics.

## Success criteria

- Reproduce reachable failure boundaries through actual local owners with synthetic inputs.
- Preserve foreground cancellation, canonical ownership, existing retries, and valid snapshot/import paths.
- Close the snapshot observability gap without retaining content or identifiers.
- ReviewGPT authors production implementation and substantive revisions; apply accepted patches exactly.
- Focused verification, parent review, final ReviewGPT and exact-head CI pass for the delivered candidate.

## Scope

- In scope: current device transport owners, bounded synthetic proof and metadata diagnostics.
- Out of scope: provider refresh/replay, production state mutations, new retry/scheduling owners, existing independently owned runtime-progress and stale-delivery PRs.

## Constraints

- Production reads expose aggregate metadata only. No private rows, payloads, credentials or raw error text in evidence.
- Telemetry remains bounded under existing retention. Bug-fix merge/deployment is not authorized; telemetry-only release retains its narrow scope gate.
- No protocol acceptance, timeout, retry or canonical-write changes without independent cause proof.

## Risks and mitigations

1. HTTP status alone can mask malformed snapshots. Compare producer/consumer metadata and keep parser rejection unchanged.
2. Failure attempts are not distinct jobs or proven lost records. Preserve that distinction in reports and recovery checks.
3. New diagnostics can leak content or add costs. Use closed vocabularies, bounded counters and existing log owners; test private sentinels and mixed versions.

## Tasks

1. Reverify current ownership, code and aggregate evidence.
2. Reproduce transport/decode/deadline failures locally and inspect caller behavior.
3. Request and inspect ReviewGPT-authored minimal diagnostics or demonstrated correction.
4. Verify candidate, close this plan and deliver the reviewed PR.
5. Release telemetry only when exact reviewed scope and normal gates allow; observe natural failures.

## Decisions

- Provider timeout and socket error classifications alone do not justify widening retries or deadlines.
- The concrete missing signal is whether a successful Web snapshot was malformed at production or changed before consumer decoding.
- Changelog is not applicable for metadata-only instrumentation; revisit if behavior changes.

## Verification

- Synthetic transport and source-state tests, affected typechecks, complexity and docs guards.
- Baseline proof: seven Cloudflare transport tests pass through the actual artifact uploader and snapshot decoder/parser. A real TCP close proves retryability, later owner retry and success deduplication.
- Baseline proof: one real HTTP Junction stalled-response test and four existing deadline/caller-cancellation tests pass; device-syncd typecheck passes.
- The real-network scenarios establish error-boundary behavior, not the external cause of a production socket closure or slow provider response.
- First exact ReviewGPT implementation passes 541 Cloudflare and 30 Web tests, plus Cloudflare, Web and device-syncd semantic typechecks. Existing canonical receipt batch/failure proof adds three passing tests.
- The exact same-author revision extracts the unchanged synchronous decode block. Final complexity passes: transport debt 22 to 20 and maximum 42 to 40; the pre-existing connection-update parser remains 21 and unchanged. Further extraction outside the diagnostic boundary is not justified.
- Documentation index updated for the new reliability contract. Reused existing ReviewGPT attachment-export friction; no new Frog entry.
- Final candidate rerun: 541 Cloudflare tests and Cloudflare semantic typecheck pass. Web/device-syncd source did not change after their passing checks. Total focused passing tests: 579.
- Parent candidate review: metadata-only source scope, no new acceptance/retry/state owner, no payload or raw-header logging, public package/test boundaries preserved, and both rollout orders covered. No remaining local finding.
- Documentation drift, gardening and whitespace checks pass. Final external review, exact-head CI, merge and release remain delivery gates tracked in the PR; no production success or all-failure recovery is claimed by this implementation record.
Completed: 2026-09-08
