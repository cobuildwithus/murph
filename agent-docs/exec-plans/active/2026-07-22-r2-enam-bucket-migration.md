# Move hosted R2 bundles to Eastern North America

Status: active
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Enable operators to move the hosted bundles buckets from Oceania to newly
  created Eastern North America buckets with a short, bounded write pause.
- Keep the runtime architecture unchanged: copy immutable object bytes and
  metadata, switch the existing bucket configuration together, and retain the
  old bucket only as a temporary rollback source.

## Success criteria

- Migration tooling fails closed unless source and destination are different,
  the destination reports the `enam` location, lifecycle rules match, and the
  final exact simple-ETag inventory verification succeeds.
- The runbook covers a live bulk copy, representative staging metadata and
  restore proof, a drained final delta, fenced configuration cutover, smoke
  checks, rollback, and eventual source-bucket retirement without exposing
  credentials.
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
- Copy the complete durable bucket, not only workspace snapshots. Force one
  server-side CopyObject with metadata preservation and fail closed unless
  exact keys, sizes, simple ETags, and storage class match. Prove
  representative v2 metadata/checksums during staging rehearsal. Exclude
  lifecycle-bound transient prefixes from the live seed and block final
  cutover until they expire so copy time cannot reset privacy retention.
- Pause new writes and drain issued upload URLs before the final delta because
  bucket identity is part of the upload target even though it is not part of
  stored snapshot refs or encryption AAD.
- Treat verification failure as a hard cutover blocker. Do not add an
  old-bucket runtime fallback to work around incomplete copying.

## Tasks

1. Confirm current R2 location, binding, presign, lifecycle, write-drain, and
   rollback invariants from code and current official Cloudflare tooling.
2. Implement the smallest deterministic copy and verification command with
   pure, focused regression coverage.
3. Document preview rehearsal, production bulk copy, maintenance-window final
   delta, configuration cutover, smoke checks, and rollback.
4. Run focused tests, canonical diff and acceptance verification, completion
   reviews, CI, and exact-head ReviewGPT.
5. Open a draft PR without executing the production migration.

## Evidence

- Both configured hosted bundles buckets currently report the `oc` location,
  while the inspected hosted containers run in Eastern North America.
- The production bucket contains roughly 77 GiB across roughly 61,000 objects,
  including multiple hosted object families, so a live initial copy is needed
  before the bounded write pause.
- Existing deploy preflight requires the presign bucket name to equal the
  Worker `BUNDLES` binding bucket, which provides one cutover invariant rather
  than a second runtime configuration path.
- R2 bucket location is fixed at creation, including after same-name
  recreation; the destination must therefore use a new name and an explicit
  `enam` creation hint.
- Pinned Wrangler output and the live source were checked against the two
  canonical lifecycle rules without exposing bucket names.
- Durable artifact and browser-replica writers can overwrite an existing key
  with fresh encrypted bytes, so an ETag-subset provenance rule would be
  brittle. The temporary pair-bound marker proves destination ownership while
  exact equality remains the post-fence gate.
- A disposable local S3-compatible rehearsal caught and corrected a
  pre-encoding mistake in targeted `CopyObject`. The final raw AWS CLI source
  value copied a nested special-character key, preserved content/custom
  metadata and the simple ETag, and let final `sync --delete` remove a
  destination-only object while retaining the excluded provenance marker.
