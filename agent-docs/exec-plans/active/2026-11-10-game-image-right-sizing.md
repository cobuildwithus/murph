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
  Avatars are at most 76pt (228px at 3x), but currently decode at 600px.
  A warm history read skips photo loading when Games first opens.
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

Cloudflare variants read succeeds, but `gameface` and `gamethumb` are absent. Create the private
240x240 crop face and 480x640 crop photo-preview variants with metadata stripped before Worker deployment.
Worker precedes Web, which precedes the new app. An older Worker rejects thumb;
history preserves stable media links in that case. No production change has been
performed by this continuation. Existing 600px/1600px definitions stay intact.
App requests must not ship before the additive backend contract is live.

## Verification

- Both iOS schemes build with Xcode 26.6; generation, authored-source lint and
  motion checks passed. Final image/drawer suites: 43 tests passed. Meal and
  history suites: 24 and 43 tests passed respectively.
- Pair-board and You screen evidence: 42 tests passed on each of SE and Pro Max;
  the changed screens were inspected. MotionBuildsUITests: both tests passed.
  Duo rendering proof is in progress; the Paper document connection is unavailable.
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
- Required ReviewGPT and exact-head CI are pending. Production variants,
  hosted deployment and app release have not been performed.
- Screenshots, raw diagnostic data and review responses stay out of Git.
