# Retire the OC R2 compatibility bridge

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Prove that no OC presigned capability can remain valid after the completed
  ENAM cutover.
- Collapse hosted object storage back to one ENAM bucket and delete the
  temporary OC-to-ENAM compatibility surface.

## Success criteria

- The live Worker remains fully `destination_active+open`, the final possible
  OC capability issuance predates every repository-defined expiry and drain
  bound, and no source fallback is observed during the retirement check.
- Runtime reads, writes, direct uploads, restore, and account deletion use one
  ENAM bucket with no phase, fallback, dual-delete, or bucket-affinity state.
- Deploy rendering, preflight, lifecycle application, smoke, hosted-local, and
  shared status contracts describe the single-bucket architecture.
- Migration-only Web controls, tests, live docs, and the active bridge plan are
  retired while immutable completed plans remain untouched.
- Focused checks, exact-head CI, preliminary specialist review, and final
  ReviewGPT complete with no unresolved actionable findings.

## Constraints

- Do not delete or mutate the production OC bucket as part of repository work.
- Preserve durable encrypted-object ownership, direct-R2 signing, lifecycle
  backstops, account deletion, and legacy snapshot restore compatibility.
- Keep the ENAM-only deployment cut atomic: `BUNDLES`, the presign bucket name,
  lifecycle owner, and smoke target must agree on the same bucket.
- Do not expose credentials, object keys, account identifiers, member
  identifiers, or production rows in repository artifacts.

## Tasks

1. Complete live capability-expiry, current-version, and fallback evidence.
2. Map every migration-only runtime, deploy, Web, harness, test, and doc surface.
3. Implement the smallest single-bucket ENAM architecture and focused coverage.
4. Run focused verification and inspect the candidate diff for accidental
   identifier or secret leakage.
5. Commit and push the exact candidate, open the PR, start specialist and final
   ReviewGPT concurrently with CI, resolve findings, and close this plan.

## Verification log

- Live cutover and credential-repair workflows were green. The last source
  write-capable deployment completed more than ten hours before retirement
  inspection, exceeding the ten-minute PUT capability plus ten-minute drain and
  the one-hour GET capability bounds.
- The current production deployment was at 100 percent with destination writes
  open. Both completed convergence passes had already found zero source-only
  objects, and a bounded filtered live Worker watch observed zero source-bucket
  fallback reads.
- Cloudflare, hosted-local, and hosted-execution typechecks passed.
- Focused Cloudflare tests passed 701 of 702 checks; the single scaffold drift
  assertion correctly caught the test fixture still naming the retired bucket
  and passed after the fixture was updated to the canonical ENAM bucket. The
  complete Cloudflare verify lane then passed 130 files and 2,215 tests,
  including Workers-runtime coverage.
- Focused hosted-local environment and MinIO tests passed 112 checks. The stack
  suite initially failed on missing workspace build artifacts rather than the
  changed behavior; after an incremental workspace build, the exact changed
  MinIO-to-Worker wiring test passed.
- Focused Web route tests passed all seven checks after generating the local
  Prisma client. The prepared Web typecheck then passed after generating the
  ignored Health Commons catalog artifacts.
- The hosted-execution suite passed 44 files and 484 tests. Workspace package
  incremental build, docs drift, and `git diff --check` also passed.
- Preliminary specialist review found that the account-deletion success tests
  did not prove behavior while the retired maintenance environment value still
  existed during rollout. The existing success checks now run with that stale
  value set; the focused two-file Web route run passed all seven checks.
