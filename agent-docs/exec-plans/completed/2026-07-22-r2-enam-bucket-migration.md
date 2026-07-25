# Move hosted R2 bundles to Eastern North America

Status: completed
Created: 2026-07-22
Updated: 2026-07-25

## Goal

- Enable operators to move the hosted bundles buckets from Oceania to newly
  created Eastern North America buckets inside one write fence that covers the
  whole copy.
- Keep the runtime architecture unchanged: copy immutable object bytes and
  metadata, switch the existing bucket configuration together, and retain the
  old bucket only as a bounded retirement safety copy.

## Success criteria

- Migration tooling refuses to run outside the declared write fence and fails
  closed unless source and destination are different, the destination reports
  the `enam` location, lifecycle rules match, and the exact simple-ETag
  inventory verification succeeds.
- The runbook covers window sizing from measured volume and a measured rate,
  the preview-bucket rehearsal/move, representative metadata and restore proof,
  the fenced whole-bucket copy, fenced configuration cutover, post-deploy parity
  checks, pre-commit rollback, a version-forced cold restore canary, and
  source-bucket retirement without exposing credentials.
- No permanent dual-read path, application runtime state, data-model
  migration, or dependency is introduced. A zero-byte pair-bound provenance
  marker exists only through the bounded rollback window and is removed with
  the explicit old-bucket retirement operation.
- Focused tests, diff-aware verification, required audits, CI, and ReviewGPT
  pass for the exact PR head.

## Scope

- One-time R2 bucket migration tooling and focused tests in `apps/cloudflare`.
- A standalone operator runbook for the preview rehearsal and production
  cutover.
- The existing package command surface needed to invoke the tool.

## Constraints

- Do not mutate Cloudflare or GitHub production state while preparing this PR.
- Never print, persist, or pass R2 credentials on a command line.
- Copy the complete durable bucket, not only workspace snapshots. Use explicit
  single-operation server-side CopyObject requests with metadata preservation
  and source-ETag conditions; never give the tool delete authority. Fail closed
  unless exact keys, sizes, simple ETags, and storage class match. Prove
  representative v2 metadata/checksums during staging rehearsal.
- Copy the whole bucket inside the fence rather than pre-seeding against a live
  source. Ordinary bundle and snapshot cleanup deletes source objects, so any
  copy that runs before the fence can leave a destination object the source no
  longer has, which no delete-free tool can reconcile.
- Pause new writes and drain issued upload URLs before the copy because bucket
  identity is part of the upload target even though it is not part of stored
  snapshot refs or encryption AAD. Run the parity proof again after the binding
  deploy so eventual Durable Object code skew cannot hide an orphan cleanup or
  an account deletion in the switch window.
- Treat verification failure as a hard cutover blocker. Do not add an
  old-bucket runtime fallback to work around incomplete copying.

## Tasks

1. Confirm current R2 location, binding, presign, lifecycle, write-drain, and
   rollback invariants from code and current official Cloudflare tooling.
2. Implement the smallest deterministic copy and verification command with
   pure, focused regression coverage.
3. Document window sizing, preview rehearsal, the fenced whole-bucket copy,
   configuration cutover, smoke checks, and rollback.
4. Run focused tests, canonical diff and acceptance verification, completion
   reviews, CI, and exact-head ReviewGPT.
5. Open a draft PR without executing the production migration.

## Evidence

- Both configured hosted bundles buckets currently report the `oc` location,
  while the inspected hosted containers run in Eastern North America.
- The production bucket contains roughly 77 GiB across roughly 61,000 objects,
  including multiple hosted object families. The fence must therefore cover a
  copy of that size, which the runbook sizes from `wrangler r2 bucket info`
  volume and the timed preview rehearsal rate rather than an assumption.
- Existing deploy preflight requires the presign bucket name to equal the
  Worker `BUNDLES` binding bucket, which provides one cutover invariant rather
  than a second runtime configuration path.
- R2 bucket location is fixed after creation. The authoritative OC source is
  never recreated; the destination uses a new name and an explicit `enam`
  creation hint.
- Pinned Wrangler output and the live source were checked against the two
  canonical lifecycle rules without exposing bucket names.
- Durable artifact and browser-replica writers can overwrite an existing key
  with fresh encrypted bytes, so an ETag-subset provenance rule would be
  brittle. The temporary pair-bound marker proves destination ownership while
  exact equality remains the post-fence gate.
- A disposable local S3-compatible rehearsal caught and corrected a
  pre-encoding mistake in `CopyObject`, but exact-head review found that AWS
  high-level sync still emitted a slashless copy-source value incompatible
  with R2's documented contract. The final design deletes sync and all
  destination deletion, uses explicit leading-slash copy sources with ETag
  preconditions, and makes final a read-only exact-parity gate. A real preview
  R2 metadata and restore rehearsal remains a mandatory production prerequisite.
- A final disposable MinIO/AWS CLI v2 execution proved special-character copy
  sources, source-ETag preconditions, used metadata preservation, conditional
  marker creation, exact read-only final, and refusal of destination extras.
  Across 36 generated AWS calls it observed no delete or high-level sync path.
- Exact-head review round 1 returned `RETROSPECTIVE_REQUIRED` against the
  earlier live-pre-seed shape: a copy that runs while production is live cannot
  converge, because ordinary snapshot and bundle cleanup deletes an already
  copied source object and the delete-free destination rule then rejects the
  whole destination. The recorded retrospective chose the frozen whole-bucket
  copy over destination reconciliation or a deletion fence, which also deleted
  the temporary account-deletion block, the 24-hour ownership lease, the
  abandonment escalation, and the two-phase seed/final command surface.
- Round 2 accepted two review-induced findings against that shape. The fence
  did not actually freeze the source, because `HostedUserRunner` orphan-cleanup
  alarms fire on schedule with no invocation; and copying staged
  lifecycle-managed objects restarted their 24-hour and 31-day deletion
  backstops. The fixes use existing owners only: the fence now holds for the
  existing 65-minute `WORKSPACE_SNAPSHOT_ORPHAN_CLEANUP_MIN_AGE_MS` past the
  last possible write so no candidate can become newly eligible during the
  copy, and the migration refuses to start while either lifecycle-managed
  prefix is non-empty. Round 2 also showed that a parity failure followed by a
  reflexive rollback could republish an accepted account deletion, so the
  recovery direction is now chosen from the proof's failure shape, which the
  tool already reports distinguishably.
- The focused migration suite passes all 35 cases, Cloudflare typecheck passes,
  and the canonical `test:diff apps/cloudflare` lane passes.
Completed: 2026-07-25
