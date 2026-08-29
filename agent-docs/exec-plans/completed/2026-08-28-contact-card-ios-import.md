# Restore the settings contact-card portrait flow

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Reproduce the settings contact-card failure on the current iPhone runtime
  before changing product code.
- Make the existing flow truthful and complete on current iPhones with the
  smallest maintainable change at the owning boundary.

## Product UX Patch

- Outcome: saving Murph from Settings creates a correctly named contact with
  the chosen portrait, or gives a complete supported recovery path when the
  system importer cannot preserve that portrait.
- Reaches: the existing authenticated Settings contact-card customization
  journey on iPhone.
- Proof: the generated vCard is checked independently for its selected image
  and contact fields, then imported on an iPhone 17 simulator running the
  current iOS runtime; focused route, component, and interaction coverage locks
  the resulting behavior.

## Scope

- In scope: the Settings contact-card picker, its Web-owned export route and
  generation code, focused regression coverage, and current-iPhone runtime
  proof.
- Out of scope: changing contact routing, phone-number ownership, native app
  contact permissions, persistent avatar preferences, or unrelated settings.

## Constraints

- Use only synthetic contact data in reproduction artifacts and tests.
- Do not copy screenshot content or member identifiers into repository files.
- Prove whether the portrait is present and lossless before testing the iOS
  importer.
- Preserve the existing authenticated export and Safari handoff boundaries.
- Prefer deletion or a direct owner-level correction over new state or
  background machinery.

## Tasks

1. Generate and independently validate the current vCard shape with a selected
   production portrait asset.
2. Import it on iPhone 17 / current iOS and capture the preview result before
   editing implementation code.
3. Implement the smallest owner-level correction or supported recovery path,
   with focused regression coverage.
4. Run focused tests, typecheck, Product UX replay, design representation proof,
   privacy review, and final diff inspection.
5. Commit and push the candidate, open a draft PR, and run the required
   preliminary Product UX, frontend, and coverage ReviewGPT lenses with CI.

## Verification

- Independent vCard field, folding, and decoded-image equality checks.
- iPhone 17 simulator import on the latest installed iOS runtime.
- Focused contact-card generator, route, picker, and settings tests.
- Web typecheck and `git diff --check`.
- Reviewer-openable design representation for each changed UI state.
- Exact-head CI and preliminary specialist ReviewGPT pass.

## Product UX Walkthrough

- Selected portrait: a vCard using the current generator shape and the Rancher
  asset opened in the native contact preview on an iPhone 17 simulator running
  iOS 26.5, with the portrait and both synthetic phone rows intact.
- Settings save: the authenticated route now reads the selected portrait from
  the route's own traced assets and embeds those exact bytes in the vCard.
- Intentional no-photo choice: `avatar=none` still creates a card without a
  `PHOTO` row.
- Missing selected portrait: the direct and in-app-browser actions check the
  portrait before navigation, keep the picker open, and show a retry action
  instead of closing onto a raw error response or silently substituting the
  initial avatar.
- Existing handoff, session, member routing, backup-number, and unknown-avatar
  behavior remains covered by the focused route suite.
- Design representation: no component or visual state changed; the production
  picker remains represented on `/design?tab=components`.

Result: ready for exact-head review.

## Local Evidence

- Pre-fix current-iPhone reproduction separated the two boundaries: iOS 26.5
  displayed an independently validated embedded PNG, while the production
  Settings route's only omission path converted a failed self-fetch into a
  successful photo-less response.
- A focused regression test failed before implementation because a selected
  portrait with no loaded bytes returned HTTP 200 instead of a retryable error.
- Focused Web tests: 94 passed across contact-card routing, vCard generation,
  real asset loading, and Next trace configuration.
- Remediation proof first failed in three focused places: the browser handoff
  was issued without checking its portrait, the direct picker had no retry
  action boundary, and the trace glob included full-resolution portraits.
- The corrected picker, route, vCard generator, real-asset, and trace suite
  passes 113 focused tests, including direct and iOS-webview retries plus
  Android direct navigation.
- `pnpm --dir apps/web typecheck`: passed.
- Targeted production Webpack build: passed and emitted the dynamic
  `/api/murph-contact-card` route. Its route trace contains exactly all 11
  selectable portrait and logo assets, no unused full-resolution portraits,
  and 1,685,492 traced avatar bytes instead of the prior 16,038,991.
Completed: 2026-08-28
