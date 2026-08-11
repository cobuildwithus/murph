# Keep nutrition goal direction inside the static Messages card

## Goal

Remove the long provider subtitle without making under-target and over-target
nutrition results visually indistinguishable on the static Messages path.

Success criteria:

- The provider caption remains limited to date and meal count, with a short
  subcaption only for partial totals.
- Every assessed V2 goal renders one concise direction inside the image without
  repeating its target amount or relying on color alone.
- Null and unavailable goals remain neutral and unlabeled.
- Workout and generic compact-table behavior from PR #1588 remains unchanged.
- Focused render, provider-layout, changelog, typecheck, and documentation checks
  pass, followed by exact-head review and CI.

## Scope

- In: shared nutrition-status labels, the Web nutrition raster, focused tests,
  response-card documentation, and the existing changelog item.
- Out: nutrition goal calculation, card schemas, delivery ownership, native
  interaction, persisted state, and provider retry behavior.

## Constraints

- Keep Linq as the sole provider-chrome owner and the immutable card payload as
  the sole data authority.
- Reuse one status-label map across semantic and image consumers.
- Add no API, state owner, cache, queue, or compatibility service.
- Preserve V1 and already-persisted V2 rendering compatibility.

## Plan

1. Move the existing exhaustive status wording to the lower contracts owner.
2. Render assessed calorie and nutrient directions inside the static image.
3. Pin every directional status and the absence of target amounts.
4. Render and inspect the exact production route at native resolution.
5. Run focused tests, typechecks, documentation drift, exact-head review, and CI.
6. Merge, verify the exact Vercel deployment, then run the protected Cloudflare
   rollout and live smoke checks.

## Review disposition

- Accepted from final ReviewGPT round 3: color alone did not distinguish under
  from over, and the removed provider subtitle had been the only directional
  text on the ordinary static path.
- Chosen correction: keep the user-requested subtitle deletion and place the
  concise direction in the existing Web raster consumer, using the same labels
  as semantic fallback.
- Rejected: restoring the long provider goal summary or introducing another
  projection/state owner.

## Verification

- Focused Web render and changelog suite passed 51 tests.
- Operator-config response-card suites passed 10 tests; contracts and
  operator-config typechecks passed.
- Web typecheck and scoped ESLint passed.
- Documentation drift and diff checks passed.
- The production renderer produced a 1,200 × 568 PNG at native resolution. It
  was inspected directly: target direction stays legible without target amounts,
  an embedded badge, or an internal corner mask.
- Final ReviewGPT round 4 and exact-head GitHub Actions remain pending until the
  remediation commit is pushed.
Status: completed
Updated: 2026-08-10
Completed: 2026-08-10
