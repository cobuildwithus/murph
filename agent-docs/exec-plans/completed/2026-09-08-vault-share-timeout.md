# Investigate and reproduce Vault Share delivery timeout

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Outcome and protected invariant

A timed-out or canceled sharing delivery must not admit a new snapshot write after waiting for transaction admission or authority locks. Its existing durable owner retains retry responsibility, and operators must retain the underlying failure classification. Exact grant generation, active member access, source checkpoint serialization, encrypted snapshots, and foreground priority remain unchanged.

## Current owners and evidence

- Web's delivery route owns the request effect deadline and sequential destination fanout.
- The projection store encrypts before a short transaction, locks current member access and the source workspace, then conditionally replaces the exact grant.
- Prisma can retry a transaction that never began. Transaction acquisition and authority locks are asynchronous boundaries after the current deadline check; the replacement callback does not recheck cancellation or the absolute deadline.
- The route's deadline branch precedes its existing error diagnostic and therefore loses the underlying failure. Historical aggregate evidence suggests deadline exhaustion but cannot identify the exact slow operation or prove that this newly reproduced class caused that occurrence.
- Current share rows and existing projection maintenance remain the only durable state. No additional queue, watermark, scheduler, retry, or timeout extension is planned.

## Scope and proof

1. [x] Inspect current ownership, request/store/crypto/database retry paths, and existing deadline and partial-progress tests.
2. [x] Reproduce delayed transaction admission, delayed authority locks, and cancellation at the actual projection replacement owner with synthetic inputs.
3. [x] Apply the smallest proven correction and preserve useful privacy-safe failure diagnostics.
4. [x] Verify healthy delivery, timeout and cancellation, retry progress, grant revocation, stale workspace rejection, bounded sequential work, and confidential error handling.
5. [x] Complete parent review, focused typecheck and complexity checks, and applicable ReviewGPT, then close the implementation plan and commit. Required exact-head CI remains the PR completion gate.

## Product UX

Affected journeys are ordinary shared-data refresh, a delayed refresh that must retry, and a share revoked or superseded while waiting. Existing current snapshots stay readable during retry. Consent, response schema, sharing scope, UI, and assistant prompts are unchanged. Ready/Hold will be determined by composed boundary proof.

## Deployment and limits

The intended correction is Web-only with no wire or persisted shape change. Old and new runtimes retain the same retryable response contract. Local reproduction of a deadline race is not proof of the historical production failure's exact cause. No production replay, resource mutation, or deployment is authorized by this investigation.

## Verification log

- Four deterministic store cases fail on the original implementation: transaction admission, member lock, workspace lock, and caller cancellation all incorrectly return `replaced`. All four pass after the boundary checks.
- Focused store and route proof: 62 tests passed. Coverage includes retry progress across paged destinations, exact generation and committed-source guards, sequential maximum-page fanout, typed missing-root continuation, and unchanged generic retryable responses.
- Real PostgreSQL proof: both cases fail on the original projection store and pass with the fix. The real member-access and workspace-lock owners hold the writer; a controlled absolute-clock expiry or caller cancellation leaves the snapshot/version null, and a new request publishes an encrypted snapshot that decrypts correctly. Encryption uses the existing synthetic secure-box test codec; native database locks, transactions and persistence are real.
- Web typecheck passed after correcting the new proof fixture's scope spelling and replacing an unsupported test-library helper. No unrelated type errors remain.
- Complexity guard passed: route hotspot remains 26, projection store maximum remains 19; no complexity debt increase. The route retains its existing explicit generation and typed failure decisions; extracting those policies would expand this bounded fix.
- Candidate review preserves grant/access/source authority and existing retry ownership. No database or provider calls, concurrent transactions, new persisted state, timeout increases, or success-path diagnostic events are added. Product UX: Ready for the bounded deadline/cancellation correction; no UI, permission or assistant-input change.
- Changelog decision under write-changelog: not applicable; internal deadline enforcement and operator diagnostics, with no new member-facing feature or verified latency improvement to announce.
- Local shared test database was stale, so the composed proof used a new isolated, fully migrated local database. No production credentials, data, or state were used.
- Exact production cause remains unproven; this fixes a reproduced boundary defect without claiming historical incident-specific causality.
- Scoped ESLint passed with one unchanged pre-existing unused-variable warning in a fixture. Documentation drift and diff whitespace checks passed.
- Final ReviewGPT round 1 passed on `beb6ef457a94ba02391a010de84f57af260a6222` with no qualifying findings. The actual response model was verified as `gpt-6-pro`; response SHA-256 is `5b4729b0efe1b8a87ef2312e006f5b566e848cb6b6672622af45b184dabf5a7e`. The first profile failed before submission; the successful fresh review used the Phlebas lane. No review remediation was necessary.
- PR #3055 is the live completion owner for required exact-head CI. A transient artifact-upload HTTP 403 passed on a failed-job rerun; Temporal compatibility, billing, cardinality and repository hygiene subsequently passed. The final documentation-only closure commit must retain green required CI before the task is reported ready.
- Implementation and parent review are complete. Closing this plan changes no production code or tests; no second substantive ReviewGPT round is needed. No merge, deployment or production replay was performed.
Completed: 2026-09-08
