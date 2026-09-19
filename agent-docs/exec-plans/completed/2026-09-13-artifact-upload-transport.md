# Recover transient artifact upload transport failures

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Goal

Finish an immutable hosted artifact upload after a brief response-less transport failure, without restarting device collection or extending the upload deadline.

## Owner and evidence

The container artifact store currently calls fetch once. A synthetic first-call TypeError followed by success therefore fails the upload. The Worker validates the live write fence and the storage owner verifies the content hash. Existing SHA deduplication and durable device job backoff remain the owners.

## Scope and invariants

Extend only the artifact PUT transport boundary with at most one serial retry for classified transient transport failure. Preserve original bytes, object identity, authority headers, deadline and typed final failure. Do not replay HTTP responses, cancellation, timeout, unknown errors or authority rejection. No provider timeout changes, queue, schema, dependency, production operation or deployment.

## Architecture decision

Deletion or reordering cannot recover a response-less call. Extend the existing PUT owner; reuse existing transport diagnostics and bounded delay where appropriate. Do not generalize retries for mutable writes. ReviewGPT authors production changes; the parent supplies synthetic proof and validates the exact patch.

## Product UX

- Outcome: Brief upload interruptions can recover within the current sync pass.
- Reaches: Existing device imports and other callers of the same immutable artifact store; ordinary uploads and durable retry fallback remain supported.
- Proof: Synthetic lost response, persisted encrypted bytes readback, concurrent dedupe, exhausted transport, denied fence and deadline cases. No live resource-completeness claim.

## Tasks

1. Reproduce the current one-fetch failure with a focused regression.
2. Obtain and inspect the ReviewGPT-authored patch, including bounded recovery and owner documentation.
3. Run focused artifact/platform/Worker tests, Cloudflare typecheck, changelog proof, complexity and docs checks; review the entire candidate.
4. Commit and open a draft PR, then mark the stable candidate Ready and start final ReviewGPT concurrently with exact-head CI.
5. Resolve the review under current task authority, verify required checks and current-base mergeability, and hand off the green unmerged PR.

## Failure and deployment

Two failed calls retain existing durable backoff. Worker authorization is repeated for every HTTP request; stale authority never becomes a successful upload. Both deployed consumers accept the same request headers and artifact shape; no coordinated migration or compatibility owner is needed. Existing R2 service retries remain separately bounded.

## Verification

Baseline regression failed as expected; baseline platform/outbound tests passed (525). Accepted exact ReviewGPT production blob 854d4134e238030f8e54f96b7c91e7f5590cb416. Native focused proof passes 582 tests, including decrypted byte/hash readback after response loss, original deadline and fence preservation, denial and exhaustion. Cloudflare typecheck passes after a parent-owned test-only Request clone type correction. Complexity passes with no hotspots above 20 (maximum 18). Docs drift passes after index update. Parent candidate review: protected success paths, state ownership, privacy and bounded replay preserved. Public changelog fragment is linked to PR #3409; all 10 archive rendering tests pass. Documentation gardening reports zero issues. Implementation and parent candidate review are complete. The PR remains unmerged; final ReviewGPT and required exact-head CI are tracked in its body and must pass before handoff as green. No production deployment or completeness claim is made.
Completed: 2026-09-13
