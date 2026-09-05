# Recover brief artifact storage failures within the existing request

Status: active
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Recover documented transient R2 artifact-write failures without repeating provider collection, weakening authority, or creating another retry queue.

## Success criteria

- A composed synthetic R2 first-write failure followed by recovery fails on the base and passes on the accepted patch.
- Retry is narrowly limited to documented service failures, the same immutable artifact, a small attempt/deadline budget, and live request authority.
- Integrity, authorization, permanent/unknown failure and cancellation paths stay fail-closed; no plaintext or object identity enters telemetry.
- Focused proof, affected typecheck, parent review, final ReviewGPT and exact-head CI pass.

## Scope

- Existing artifact upload boundary, bounded diagnostic metadata, focused tests and owner docs.
- Continue read-only classification of other device-sync failure families and verify the separately authorized telemetry rollout.
- No production replay, resync, job reset, member messages, credentials, new persistence or schedulers.

## Constraints

- ReviewGPT authors all production implementation and substantive revisions; local agent owns test-only reproduction, investigation and delivery.
- Existing device-sync job retry remains terminal fallback. No blanket catch/retry, no retry for unclassified errors or non-idempotent operations.
- Actual provider faults cannot be eliminated by repository code. State the limits of resilience proof and natural recovery evidence.

## Risks and mitigations

- Narrow R2 service-code classification; do not infer retryability from arbitrary prose.
- Preserve exact user/artifact/write-fence authority and request cancellation before any second storage attempt.
- Keep storage retries at the current artifact owner; avoid changing generic crypto or unrelated storage writes.

## Tasks

1. Classify production failures using bounded metadata and current official R2 documentation.
2. Reproduce a recoverable artifact-write failure with synthetic first-attempt rejection.
3. Obtain and apply a ReviewGPT-authored minimal patch, validate negative/security cases and inspect the full diff.
4. Complete scoped commit, PR, final review and required CI. Preserve separate production action boundaries.

## Decisions

- R2 documents 10001 InternalError and 10043 ServiceUnavailable as retryable service failures. No evidence supports retrying authentication, integrity, malformed-data, or arbitrary exceptions.
- Junction timeout and source-state failure families need independent evidence; do not imply the artifact patch resolves them.

## Verification

- Planned composed runner-outbound tests, relevant artifact storage/runtime tests, Cloudflare typecheck, complexity and documentation guards.
- Observe natural failed-attempt categories and canonical imports after separately authorized releases; do not force production failures or recovery.

## Product UX patch

- Outcome: Recover a brief artifact-save service failure within the current import attempt.
- Reaches: Hosted artifact uploads with a recognized transient storage failure and enough remaining request time; preserve cancellation, revoked authority, permanent failure and prolonged-outage behavior.
- Proof: Composed upload-to-storage tests with exact ciphertext reuse and decrypted readback, plus durable-job backoff proof. This patch does not change provider collection or guarantee recovery from every outage.

## Implementation evidence

- ReviewGPT authored the accepted patch against the supplied snapshot. The local owner verified its exact response/model and artifact control, inspected the full patch, and applied it without changes.
- The strict artifact exporter rejected a presentation-only response difference. Independent message identity and normalized full-response verification recovered the same sole attachment without altering the captured metadata.
- Focused validation and parent review are in progress. Production bug-fix merge/deploy remains outside the standing automation authority.
