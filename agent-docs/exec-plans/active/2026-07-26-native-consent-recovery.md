# Native consent recovery

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Let a signed-in iOS companion member complete missing launch consent inside
  the app with one clear action, then automatically resume the blocked setup or
  sync flow.
- Keep Home, Settings, legal links, account deletion, and sign-out available
  while health-data authority is paused.

## Success criteria

- The companion API reads and records the same hosted consent grants used by
  the website through Privy bearer authentication.
- Missing consent closes Junction and automatic meal-photo authority without
  signing the member out of Privy.
- The native consent prompt uses the current server-provided document versions
  and links, accepts every missing launch scope from one `I Consent` action, and
  automatically restores the blocked flow.
- Focused Web and iOS tests, canonical verification, rendered simulator proof,
  required product review, and the final cross-cutting review pass.

## Scope

- Hosted Web companion legal-consent route, focused route tests, and current
  consent contract documentation.
- iOS consent API models, session state transition, native SwiftUI consent
  prompt, focused tests, screenshot harness, and iOS product/architecture docs.

## Constraints

- Hosted Web remains the sole owner of persisted consent truth and document
  versions.
- Do not use browser cookies or a web redirect for native consent.
- Do not retain active health or meal authority while launch consent is
  incomplete.
- Consent recovery must not turn ordinary network errors into consent grants,
  sign users out, or hide account deletion and legal surfaces.
- Preserve the existing consent-remediation lane; it does not own this
  companion API or native app surface.

## Tasks

1. Add one bearer-authenticated companion consent route for status and
   launch-scope acceptance with focused contract coverage.
2. Replace the iOS app-wide consent failure with a limited signed-in state that
   closes health-data authority and presents native consent.
3. Resume launch, meal enrollment, or meal approval after acceptance and keep
   non-health account surfaces usable while pending.
4. Add native rendered proof and complete required verification and review.
5. Commit, push, merge in backend-first order, upload the new iOS build, and
   close this plan.

## Verification

- Focused hosted-web Vitest for the companion consent route and existing legal
  consent unit coverage.
- `pnpm test:diff` for the exact hosted-web/doc paths.
- `pnpm verify:acceptance`.
- `xcodegen generate`, SwiftFormat lint, focused and full iOS simulator tests,
  and simulator screenshots for loading, required, error, and restored states.
- Product-experience review, preliminary specialist review, CI, and final
  ReviewGPT for each eligible PR head.

## Deployment

- Deploy/merge Hosted Web first so the bearer-authenticated consent endpoint is
  available before the new iOS build reaches users.
- The existing iOS build remains compatible with the new endpoint; the new iOS
  build must not be released before the endpoint is live.
