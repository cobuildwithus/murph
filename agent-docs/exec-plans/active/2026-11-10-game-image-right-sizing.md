# Right-size app image delivery and decoding

Status: active
Created: 2026-11-10
Updated: 2026-11-10

## Outcome and invariant

App images load promptly at a rendition appropriate to the rendered surface,
with no loss of sharpness on Retina displays, full-screen views or recap exports.
The existing private media authorization, signed URL expiry, account-scoped
cache and memory-only handling of rendered health cards remain authoritative.

## Owners and evidence

- Backend PR #4808 owns the additive private 240px `gameface` and 480x640px `gamethumb` renditions,
  alongside existing 600px and 1600px renditions. History previews are 64pt high.
- iOS PR #533 owns request selection, decoded size and queue priority.
  Avatars are at most 76pt (228px at 3x); they previously decoded at 600px.
  A warm history read previously skipped photo loading when Games first opened.
- Home's live film strip downloads full 1600px images for earlier days even
  though only tiny photos or non-image artifact indicators are displayed.
- Meal rows are 56pt squares but decode the whole protected thumbnail on the
  main actor. The existing sanitizer already supports aspect-fill downsampling.
- CDN requests omit image format negotiation. Query ImageIO's supported types
  before advertising AVIF/WebP; keep JPEG/PNG and never alter capability URLs.

## Smallest changes

1. Finish the warm-history and page-order fix, including the final compile.
2. Use 240px for avatars and 480x640px center-cropped photo previews.
   The 3:4 crop happens before shrinking so landscape photos retain detail;
   the preview covers expanded frames on the unfolded display. Keep uploads intact.
3. Use full-size requests for current/previous lead posts and explicit recap
   days; use thumbnails for other live film photos and omit unseen artifact bytes.
4. Preserve full-size settled reels, zoom and exports. Keep contact-sheet cards
   memory-only at every rendition.
5. Decode meal tiles off the UI executor at actual frame size times display scale.
6. Complete focused tests, both iOS scheme builds, rendering checks, parent
   review and required ReviewGPT on stable pushed heads.

## Rollout and failure

The private 240x240 crop `gameface` and 480x640 crop `gamethumb` variants
were provisioned and read back with metadata stripped and signed URLs required.
Existing 600px/1600px definitions remain intact. Backend #4808 and iOS #533
are merged. Protected hosted deployment 42902482615 succeeded with Worker-only
rollout and production smoke checks, using backend commit
`8cd536d936d92fc1bc875bf4c528ce4dbfcd0b7e`. Web production admission passed,
and the production domain was verified serving that same commit. The app's
full release checks remain pending.
An older Worker rejects thumb; history preserves stable media links in that case.
App requests must not ship before both additive Worker and Web contracts are live.

## Verification

- Both iOS schemes build with Xcode 26.6; generation, authored-source lint and
  motion checks passed. Final image/drawer suites: 43 tests passed. Meal and
  history suites: 24 and 43 tests passed respectively.
- Pair-board and You screen evidence: 42 tests passed on each of SE and Pro Max;
  the changed screens were inspected. MotionBuildsUITests: both tests passed.
  Duo closed and expanded-window rendering was inspected with Xcode 27.2.
  Physical fold behavior was not verified; the Paper document connection is unavailable.
- Worker image store/deploy admission: 46 tests passed. Control client: 93.
  Web media/routes/changelog: 119. All three affected TypeScript checks pass.
  Complexity guard passes; the existing client hotspots are unchanged.
- Focused proof covers size selection, full-size promotion, signed CDN bearer
  isolation and WebP decoding, account cache isolation, contact-card privacy,
  meal aspect-fill pixels, variant configuration and old-Worker fallback.
- Opt-in PostgreSQL tests were not run locally: the reserved test database has
  no game schema. Changed expectations are variant names; route and authority
  unit coverage passed. The required CI database lane remains authoritative.
- SwiftFormat excludes downloaded build dependencies, as recorded by existing
  Frog entry 20261109114751. No new developer-friction entry was needed.
- Parent review found that a 240px scale-down would soften cropped landscape
  previews. Dedicated square-face and 3:4 photo crops preserve Retina detail;
  uncropped cards and full-size opened photos retain their own renditions.
- Required ReviewGPT passed on both reviewed implementation heads. Backend
  required PR checks passed. The exact merged backend tree then hit a transaction
  timeout in the unrelated 1,000-game activation PostgreSQL proof; rerunning the
  failed lane without source changes passed. All required main checks passed.
- Build 95 is reserved by iOS #534. Release CI exposed a busy-button
  accessibility-label mismatch; test-only iOS #536 fixes the lookup and all
  15 account-access UI tests pass. The full Games UI suite passed on the first
  corrected candidate. A separate merged finite login timeline then failed the
  expired-countdown resend journey; iOS #538 restores the working periodic
  rendering, with all 15 account-access tests passing on CI's iOS 26.5 runtime.
  Both release suites are running on the final merged candidate
  `087c912b9d3bc663a45a0ffbe6edd0132849f3ec` before upload.
- Screenshots, raw diagnostic data and review responses stay out of Git.
