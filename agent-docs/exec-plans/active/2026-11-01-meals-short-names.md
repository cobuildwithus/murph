# Short meal names and photo retention investigation

## Outcome and invariants

Outcome: Meals shows dish names rather than notes. Reaches: new logs, edits,
legacy projected meals, and non-food image handling. Proof: CLI persistence and
validation, projection fallback, assembled prompt, and focused real-model replay.
Nutrition totals, upload associations, permissions, and raw retention stay unchanged.

## Ownership and design

The meal CLI currently accepts only a note; core always titles imported meals
"Meal". Expose a short name through add/import/edit and map it to the existing
canonical event title. Keep description, portions, place, and uncertainty in note.
This reuses the existing schema and avoids reader-first schema deployment.
The existing encrypted Meals projection prefers title and cleans legacy labels.
No vault backfill, photo endpoint, thumbnail storage, or production content reads.

## Work and proof

- [x] Read workflow and trace canonical write/projection owners; rebase onto #4435.
- [x] Implement naming and small legacy fallback with deterministic proof.
- [x] Verify composed prompt and synthetic live assistant behavior; measure input.
- [x] Trace photo storage, retention, removal and account deletion; report options.
- [ ] Candidate review, changelog, scoped commit, ReviewGPT alongside exact-head CI.
- [ ] Merge and deploy Web/runtime from main; record identifiers and checks.

## Compatibility and failure

New names use the existing title string; old readers already accept and project
it. Old writers keep producing Meal/note records handled by fallback. Validation
fails before writes with correction guidance. Projection refresh follows normal
checkpoint behavior. Web then runtime deployment; no new rollback floor.

## Photo investigation (source inspection only)

The current API returns uploadId for a local-device join, never image bytes or
URLs. A plain tile does not prove that server-side image bytes are absent.

- App photos: Web stages encrypted JPEGs in private per-member R2; runtime
  imports a canonical meal with photo attachments under raw/meals and checkpoints
  the encrypted workspace before deleting staging. The staging lifecycle makes
  leftovers eligible for deletion after 31 days, not a hard purge deadline.
  Manual and automatic app captures share this import owner and external-ref
  classification. Automatic closeout can subsequently replace retained photos
  with privacy tombstones after supported observation/nutrition readback; it is
  work-driven, not a fixed number of days. Failed/pending closeout retains bytes.
- Texted images: inbox image bytes normally have a 90-day window; active work
  can defer cleanup, and canonical event raw references protect them. A meal
  logged with --photo gets its own canonical raw/meals copy without a general
  expiry. A note-only meal can lack a photo attachment even while the inbox
  original exists. Do not infer associations from time or image similarity.
- The encrypted workspace snapshot retains canonical raw files after checkpoint.
  The Meals projection currently contains no photo. API removal appends an event
  tombstone and hides it after refresh; it does not purge raw bytes. Account
  deletion owns user-scoped object cleanup, warm-container destruction, replica
  cleanup and retry receipts. Logical removal is not physical deletion proof.

Sources: core mutations.ts addMeal; core raw.ts; core domains/events/ledger.ts
and automatic-meal-photo-retention.ts; contracts constants.ts image retention;
inboxd indexing/retention.ts; assistant-runtime hosted-runtime/meal-photo-import.ts;
automatic-meal-capture skill; Cloudflare README Storage Contract; ios-meals spec.

### Recommendation, not implemented

Generate one small metadata-stripped thumbnail while each future photo is
available, bind it to the canonical meal/attachment, and serve it through the
member-authenticated Web boundary without waking the runtime. Persist it with
canonical meal-owned media and derive the encrypted projection reference from
that owner; a projection alone must not become the only surviving source after
full-photo cleanup. Prefer a bounded encrypted media object/reference over
embedding years of base64 thumbnails into the shared core shard. Reuse member
session/access/consent checks and no-store behavior; no public or long-lived URL.

This explicitly extends automatic-photo retention to a low-resolution derivative
and needs a product retention decision. Strip EXIF, bound pixel/byte size, keep
same-member access, and purge on explicit member photo removal, meal deletion and account
cleanup, including historical objects and app caches. Automatic closeout would remove full-size bytes while retaining the derivative
only under the newly chosen policy. If closeout is intended
to remove all image content, keep that promise and show a plain tile instead.
Historical purged photos cannot be recovered; do not build a backfill now.

At 20–40 KB per image, 1,000 thumbnails use 20–40 MB before replica copies and
encoding. R2 Standard is $0.015/GB-month, $4.50/million writes and $0.36/million
reads with no R2 egress charge (official pricing checked 2026-11-01). Marginal
storage is about $0.0003–$0.0006/member-month for those 1,000 images, before
rounding/free tier, copies, Web/crypto/image CPU and database overhead. A request
that wakes/restores the runtime has larger compute/latency cost and cannot
recover closeout-purged photos. Inline projection bytes are mechanically simpler
but grow every shared-shard refresh/read; retained thumbnail objects avoid that.
Pricing: https://developers.cloudflare.com/r2/pricing/

## Accepted local evidence

- CLI meal parity: 21 passing tests; rejects invalid names before add/import/edit
  and proves name edits preserve description and nutrition.
- Query companion meals: 13 passing tests; includes prefix/delimiter fallback,
  legacy null/length behavior, immutable source, totals and uploadId preservation.
- Integrated meal service: 1 passing test; importer meal cases: 11 passing tests.
- Prompt and automatic-capture suites: 6 passing tests; no conflicting generic
  image-review fallback remains.
- CLI, Assistant Engine, and Query typechecks pass; prepared runtime build passes.
- Complexity guard passes with no increase in debt or maximum. Existing CLI
  runMealAdd (33), nutrition builder (32), prompt builders (28/25), and unrelated
  core hotspots retain their existing shape; a broader split is not justified.
- Real GPT-6.1 Sol local-subscription journey passes with four canonical imports,
  no nutrition writes, no non-food meal and no delivery. Names: Cinnamon porridge;
  Beet and chickpea salad; Peach yogurt smoothie; Baked cod with potatoes.
  Reply review: Ready, concise confirmation with no invented estimates.
- Native canonical harness stopped before provider action on its documented
  missing-patch prerequisite; the supported production-prompt/built-CLI harness
  supplied the accepted live proof. Initial effect assertions counted shell
  commands; batch execution required counting canonical meal_import receipts.
- Complete first-provider-input capture: individual 156563 -> 157050 UTF-8 bytes
  (+487, +0.3111%); group 131462 -> 131462. Eager/deferred tool descriptors were
  unchanged at 61961/68726 bytes; meal CLI schemas and skills are on-demand.
  Exact target tokenizer unavailable: token totals/deltas are not claimed.
  Same synthetic fixtures, native scripted transport; excludes prompt_cache_key.
- Product UX Ready: new names, edits, legacy meals, invalid-name retry and known
  non-food exclusion covered. No production content or member messages used.

- Changelog generated and rendered through the archive test (4 passes); Web
  typecheck passes. Meals route suite passes after the standard typecheck
  generated the local Prisma client. Initial parallel route run lacked that
  generated client; no application failure or production read occurred.
- Draft PR: https://github.com/cobuildwithus/murph/pull/4437. Candidate includes
  the hook-generated CLI config/types/skill hash. Final ReviewGPT and required
  exact-head CI remain external delivery gates, followed by authorized merge
  and protected-main Cloudflare deployment.

## Review remediation

Round 1 reviewed e0876a3b1642a3b799f9e21cd4560d0202c03f12; round 2 reviewed
a60c4e65b0738edf8cdd61bd7bc500a4cad760c0. Both used Apollo/GPT-6 Pro, full
attached snapshots and exact-turn REVIEW_COMPLETE capture with the 180-second
minimum enforced. Round 2 metadata confirmed both ancestor relationships and
its current-head context anchor; stage evidence showed at least 306 seconds
waiting for the substantive response.

Accepted findings: preserving non-food stubs first blocked completion of other
selected meals; deferring them within the run fixed that case but left a full
20-item batch able to starve later work permanently. Architecture pressure
check: remove the introduced deferral instead of adding pagination, exclusions,
a classification field or a new queue. Final guidance corrects already-imported
empty stubs with only the supported non-food/non-consumption observation, never
a dish name or invented nutrition, then uses the existing read-back and photo
cleanup. Member notes are preserved. Non-food records are excluded from
presentation/questions. Fresh non-food images never authorize a meal add.
Managed automation instructions and the selector stay unchanged from main.

The deterministic 20-item case proves the existing cleanup drains the batch
and makes later genuine meals selectable on the next occurrence. The existing
bounded-per-occurrence behavior is preserved; no new same-day unlimited-drain
promise, backfill or retention policy is introduced. Removal failures retain
retry evidence and must be reported honestly; the existing notification wire
contract has send_message/skip, not a new scheduler failure variant.

CI exposed expected prompt digest/budget changes and a legacy CLI response
fixture; these were updated against the measured input and additive name field.
Route-planning 125, model-behavior 57 and CLI handler 3 tests pass. Ordinary
complete first-input measurements remain +487 bytes individual and zero group.

Main #4436 was merged normally without rewriting published history. Its only
conflict was the adjacent optional AddMealInput fields; both name and uploadId
were retained, and each side's independent propagation stayed intact. The
prepared runtime rebuild passes. Post-merge CLI 24, projection 13, photo-import
13 and Web Meals-route 31 tests pass. Composed guidance, managed automation and
20-item eligibility proof pass together (88 tests); Engine typecheck passes.

Final live closeout proof passes with GPT-6.1 Sol/local subscription (three
provider requests): truthful non-food observation with no dish name/nutrition,
existing photo cleanup, two successful nonnumeric food closeouts, and a removal
error that retains its photo and reports incomplete cleanup without totals/card.
All replies reviewed Ready; no external delivery occurred. The interrupted
prepared build was rerun successfully before the merged-code verification.
