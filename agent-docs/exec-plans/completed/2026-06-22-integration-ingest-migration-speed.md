# Integration ingest migration speed

## Goal

Cut avoidable v1-to-v2 integration-ingest migration latency while preserving the
same fail-closed migration semantics.

Success criteria:

- Identify and remove redundant full journal or vault scans on ordinary apply
  passes.
- Keep legacy artifact, manifest, journal, and event-reference verification
  intact before deletion or finalization.
- Add focused regression coverage for the performance-sensitive control flow.
- Capture local benchmark evidence before and after the implementation.

## Constraints

- Keep the architecture simple: no new migration framework, background service,
  compatibility resolver, or hosted hot-path coupling.
- Do not expose local user identifiers, secret values, raw vault payloads, or
  home paths in committed docs, tests, logs, or handoff text.
- Hosted foreground work must remain highest priority. Any conclusion about
  reply-path viability needs measured evidence, not an assumption.

## Approach

1. Profile the current migration loop enough to identify repeated expensive
   work.
2. Reuse current-pass detection data where it is already authoritative under the
   migration lock.
3. Skip avoidable finalize/final-detection work on passes that clearly have more
   legacy work remaining.
4. Run focused core tests plus a local synthetic benchmark, and compare timing.

## State

Ready to close.

## Notes

- User benchmark on a copied vault showed roughly 406 bundles, 1,627 raw files,
  6.15 MB of evidence, 16 default apply passes, and about 3.5 minutes total.
- Static inspection found prune verification reading all ingest journal rows once
  per bundle.
- Patched same-shape synthetic benchmark:
  - Host: 406 bundles, 1,627 legacy files, 6,153,443 bytes, default
    `maxBundles: 25`, finalized in 9,370 ms.
  - Docker: same shape, default `maxBundles: 25`, finalized in 14,614 ms.
- Verification passed:
  - `pnpm exec vitest run --config vitest.config.ts test/wearable-storage-migration.test.ts --no-coverage`
  - `pnpm --dir packages/core test:coverage`
  - `pnpm test:smoke`
  - `pnpm typecheck`
  - `git diff --check`
- Completion audits:
  - `security-privacy-review`: no findings.
  - `coverage-write`: no test change needed.
  - `deep-review`: no findings; residual risk remains out-of-band filesystem
    mutation that bypasses core locking, which this change does not worsen.
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
