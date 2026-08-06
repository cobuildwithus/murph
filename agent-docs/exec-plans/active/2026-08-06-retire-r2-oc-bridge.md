# Retire the OC R2 compatibility bridge

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Prove that no OC presigned capability can remain valid after the completed
  ENAM cutover.
- Collapse hosted object storage back to one ENAM runtime owner and delete the
  temporary OC-to-ENAM compatibility surface, retaining only the minimum OC
  erasure binding required while migrated duplicate ciphertext still exists.

## Success criteria

- The live Worker remains fully `destination_active+open`, the final possible
  OC capability issuance predates every repository-defined expiry and drain
  bound, and no source fallback is observed during the retirement check.
- Runtime reads, writes, direct uploads, and restore use one ENAM bucket with no
  phase, fallback, dual write, or bucket-affinity state. Account deletion clears
  and proves stable emptiness in both ENAM and the retiring OC bucket.
- Deploy rendering, preflight, lifecycle application, smoke, hosted-local, and
  shared status contracts describe the canonical ENAM owner plus the narrow
  deletion-only OC binding.
- Migration-only Web controls, tests, live docs, and the active bridge plan are
  retired while immutable completed plans remain untouched.
- Focused checks, exact-head CI, preliminary specialist review, and final
  ReviewGPT complete with no unresolved actionable findings.

## Constraints

- Do not delete or mutate the production OC bucket as part of repository work.
- Do not remove per-member OC erasure until a separately authorized inventory
  proves the retiring bucket stably empty.
- Preserve durable encrypted-object ownership, direct-R2 signing, lifecycle
  backstops, account deletion, and legacy snapshot restore compatibility.
- Keep the ENAM deployment cut atomic: `BUNDLES`, the presign bucket name,
  lifecycle owner, and smoke target must agree on the same bucket, while the
  distinct retiring binding remains unavailable to ordinary runtime paths.
- Do not expose credentials, object keys, account identifiers, member
  identifiers, or production rows in repository artifacts.

## Tasks

1. Complete live capability-expiry, current-version, and fallback evidence.
2. Map every migration-only runtime, deploy, Web, harness, test, and doc surface.
3. Implement the smallest canonical-ENAM architecture and focused coverage,
   with only the retiring OC erasure path preserved.
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
- Final ReviewGPT round 1 found that convergence proved every OC object had an
  ENAM copy, not that OC was empty; single-bucket deletion could therefore
  report completion while a migrated OC copy survived. The remediation keeps
  OC unreachable to reads, writes, restores, and presigns but retains it as a
  required deletion target, with stable-empty and partial-failure retry tests.
- The remediation Cloudflare verify passed 130 files and 2,219 Node tests plus
  four Workers-runtime files and five tests. This includes fail-closed binding,
  canonical-plus-retiring deletion, partial-failure retry ownership, deploy
  rendering, preflight location, and checked-in Wrangler coverage.
- Hosted-local typecheck passed, and its suite passed 28 files and 417 tests
  with one skip while using the documented single local-bucket alias. The
  paired private deployment workflow passed its full typecheck, 182 tests with
  coverage, and production build; its focused environment-contract suite also
  passed all seven checks.
