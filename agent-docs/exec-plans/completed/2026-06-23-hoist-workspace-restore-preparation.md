# Hoist Workspace Restore Preparation

## Goal

Remove the measured data-key unwrap and R2 GET presign latency from the cold-restore critical path by preparing both capabilities while the hosted container starts.

## Constraints

- Reuse the existing write-fenced runner invocation; add no service, database state, nonce registry, dependency, configuration, or background process.
- Keep the existing in-container unwrap/presign path only as a temporary deploy-skew fallback when prepared data is absent.
- Treat present but malformed, expired, or snapshot-mismatched prepared data as fatal. Never fall back after validation fails.
- Never log or persist the plaintext data key or presigned URL.
- Preserve the current v2 snapshot format and restore/extraction behavior.

## Implementation

1. Add one prepared-restore value carried by `apps/cloudflare`, using the shared v2 snapshot fingerprint as its only snapshot identity.
2. In runtime preparation, validate the selected v2 snapshot, resolve and unwrap its data key, and mint its short-lived GET URL concurrently.
3. Carry the prepared value in the existing secret-bearing runner job and consume it in the snapshot port.
4. Parallelize the legacy fallback's unwrap and presign operations.
5. Log how long runtime preparation remains unfinished after the runner is ready.
6. Add the missing hosted AI usage period counter backfill migration expected by the current migration guard.
7. Add focused tests for overlap, prepared-path bypass, expiry/mismatch rejection, and transport parsing.

## Verification

- Run the narrowest truthful Cloudflare diff/coverage lane available, plus typecheck.
- Exercise a prepared restore and prove no unwrap/presign control-plane calls occur.
- Exercise malformed/expired/mismatched prepared data and prove restore fails before object fetch.
- Review the final diff for secret-safe logging and deploy-skew behavior.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
