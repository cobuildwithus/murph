# Retire the OC R2 compatibility bridge

Status: active
Created: 2026-08-06
Updated: 2026-08-19

## Goal

- Prove that no OC presigned capability can remain valid after the completed
  ENAM cutover.
- Collapse hosted object storage back to one ENAM runtime owner and delete the
  temporary OC-to-ENAM compatibility surface, including every OC binding.

## Success criteria

- The live Worker remains fully `destination_active+open`, the final possible
  OC capability issuance predates every repository-defined expiry and drain
  bound, and no source fallback is observed during the retirement check.
- Runtime reads, writes, direct uploads, and restore use one ENAM bucket with no
  phase, fallback, dual write, bucket-affinity state, or OC binding. Account
  deletion clears and proves stable emptiness in the canonical ENAM bucket.
- Deploy rendering, preflight, lifecycle application, smoke, hosted-local, and
  shared status contracts describe only the canonical ENAM owner.
- After the physical buckets are absent, migration-only Web controls, tests,
  live docs, and the active bridge plan are retired while immutable completed
  plans remain untouched.
- Focused checks, exact-head CI, preliminary specialist review, and final
  ReviewGPT complete with no unresolved actionable findings.

## Constraints

- Do not delete either OC bucket until current-owner reconciliation, lifecycle
  repair, a no-OC Worker rollout, and final aggregate inventory all pass.
- Keep the Web account-deletion maintenance guard live until both OC buckets
  are physically absent; the protected deploy workflow can consume only public
  `main`, so the no-OC Worker rollout must precede that final Web cleanup.
- Preserve durable encrypted-object ownership, direct-R2 signing, lifecycle
  backstops, account deletion, and legacy snapshot restore compatibility.
- Keep the ENAM deployment cut atomic: `BUNDLES`, the presign bucket name,
  lifecycle owner, smoke target, and account deletion must agree on the same
  bucket.
- Do not expose credentials, object keys, account identifiers, member
  identifiers, or production rows in repository artifacts.

## Tasks

1. Complete live capability-expiry, current-version, and fallback evidence.
2. Map every migration-only runtime, deploy, Web, harness, test, and doc surface.
3. Implement the smallest canonical-ENAM architecture and focused coverage,
   with no OC runtime or deletion binding.
4. Run focused verification and inspect the candidate diff for accidental
   identifier or secret leakage.
5. Commit and push the no-OC Worker candidate with the Web guard retained, run
   exact-head review and CI, merge and deploy it, then reverify and delete the
   exact OC buckets.
6. Remove the now-obsolete Web guard in a post-deletion cleanup PR, complete its
   focused proof, archive this plan, and retire both task worktrees.

## Verification log

- Live cutover and credential-repair workflows were green. The last source
  write-capable deployment completed more than ten hours before retirement
  inspection, exceeding the ten-minute PUT capability plus ten-minute drain and
  the one-hour GET capability bounds.
- The current production deployment was at 100 percent with destination writes
  open. Both completed convergence passes had already found zero source-only
  objects, and a bounded filtered live Worker watch observed zero source-bucket
  fallback reads.
- A fresh full inventory found 1,524 production and one preview source-only
  object. Direct byte-range probes confirmed every apparent gap. Read-only
  current-owner reconciliation proved zero missing objects in active production
  user namespaces and zero current canonical references to the 323 legacy
  global bundles. The other residuals were inactive-namespace artifacts,
  retired raw-path placement, one abandoned deploy-smoke object, and retired
  transient objects.
- The only production residuals in active namespaces were two lifecycle-managed
  raw-email ciphertext objects. Those two objects and the single preview
  snapshot were copied forward and verified byte-for-byte without overwriting a
  destination object. The remaining OC objects are unowned or retired data and
  must not be retained in ENAM merely to make whole-bucket counts equal.
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
- Final ReviewGPT round 1 correctly blocked physical retirement while the OC
  buckets still contained residual objects. After the independently authorized
  reconciliation and forward repair above, the candidate now removes the
  interim deletion binding as well; fresh verification and exact-head review
  are required before rollout and bucket deletion.
- After that repair, the canonical no-OC candidate passed Cloudflare and
  hosted-local typechecks plus 221 focused Cloudflare tests across deploy
  rendering, preflight, runner environment, account deletion, and runtime
  contracts. The private deploy workflow passed its typecheck and all seven
  focused workflow checks. Both diffs passed whitespace and secret/identifier
  scans before commit.
- Deployment-workflow inspection found that protected production deployment
  always resolves public `main`; it cannot deploy an unmerged public PR head.
  The Web maintenance guard was therefore restored exactly to the current base
  for the no-OC rollout. Its two focused route files passed all 12 checks. The
  guard will be removed only after both old buckets are physically absent.
- Final ReviewGPT round 3 accepted the staged executable architecture but found
  three stale operator/source-comment surfaces that still removed the Web guard
  before physical OC retirement or described deleted OC bindings. The runbook,
  docs index, and guard comment now require no-OC Worker proof, final ownership
  reconciliation, both exact bucket deletions, and API absence before the Web
  cleanup. A deploy-surface regression check plus the retained Web guard tests
  passed 26 and 12 checks respectively.
- On 2026-08-19, the live Worker remained at 100 percent with one canonical R2
  binding and no retired binding. Historical-to-current deploy configuration
  resolved exactly two stale live buckets, both in OC, without logging their
  names or object keys. The preview target had one pre-retirement object and no
  lock rule; it was emptied, deleted, and proved absent.
- The production target reported 120,359 objects and 25.9 GB. A complete
  121-page inventory found 120,359 unique objects totaling 25,900,114,432
  bytes, with the newest write at 2026-08-07T08:12:24.856Z and zero writes on
  or after the 2026-08-08 UTC retirement cutoff. This composed with the prior
  current-owner reconciliation and forward repair above, so the target was
  emptied in bounded sequential batches and deleted. A fresh list contained
  ten live buckets and neither stale target; direct reads for both returned the
  provider's nonexistent-bucket code.
- The production-only Web maintenance variable was removed after physical
  absence and a fresh Vercel environment listing found zero remaining values
  with that name. The post-retirement cleanup removes the temporary guard from
  both Web routes, its migration-only tests and catalog frames, and the one-time
  rollout instructions while preserving durable deletion recovery states.
- Focused Web tests passed 32 checks after the ordinary generated Prisma-client
  prerequisite. The Cloudflare deploy-contract test passed 25 checks, Web and
  Cloudflare typechecks passed, and the diff passed whitespace validation.
