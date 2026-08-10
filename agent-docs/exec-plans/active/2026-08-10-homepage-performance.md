# Improve homepage mobile performance

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make the public homepage materially faster on throttled mobile connections,
  with the same visible content, interaction sequence, accessibility, and
  responsive layout.

## Success criteria

- Above-fold avatars no longer download full-resolution PNG/JPEG originals.
- Below-fold persona imagery is right-sized and modern-format.
- Any homepage JavaScript or layout-work change is backed by direct code-path
  evidence from the reported Lighthouse findings.
- Focused homepage tests, the Web typecheck, and the production Web build pass.
- Desktop and mobile rendered proof show no material visual regression.

## Scope

- In scope: public homepage image delivery, homepage-only hydration/runtime
  work proven relevant, the reported homepage contrast failures, focused
  regression tests, and existing design-catalog homepage studies.
- Out of scope: redesigning the landing page, changing product copy or flows,
  broad application bundle refactors, and accessibility findings outside the
  reported homepage surfaces.

## Constraints

- Technical constraints: keep Next.js App Router and existing component
  ownership; prefer static optimized assets or `next/image`; add no dependency
  or new state owner.
- Product/process constraints: preserve the warm research-library visual
  system, reduced-motion behavior, server rendering, and the current homepage
  section catalog.

## Risks and mitigations

1. Risk: Image compression changes avatar framing or perceived quality.
   Mitigation: preserve crop geometry and compare desktop/mobile renders at
   native resolution.
2. Risk: Deferring client work changes the hero sequence.
   Mitigation: change runtime behavior only when a focused test or browser
   trace proves the current path causes blocking work, then retain the existing
   state and reduced-motion contracts.

## Tasks

1. Trace the reported image, LCP, reflow, and JavaScript findings to homepage
   components and establish current asset/render behavior.
2. Right-size and modernize the reused avatar assets and update their render
   paths without altering layout.
3. Add focused regression proof for delivery semantics and any runtime change.
4. Run focused tests, Web typecheck/build, and desktop/mobile browser proof.
5. Complete scoped review, commit, PR, CI, and required ReviewGPT gates.

## Decisions

- Treat the PageSpeed report as the baseline measurement; reproduce locally
  where the repository's production build and browser tooling make that
  reliable.
- Optimize the measured multi-megabyte image path before considering secondary
  bundle or render work.
- Keep the authentication runtime out of the initial bundle and idle task queue;
  load it on the existing pointer/focus preparation path while preserving each
  open dialog session, retrying transient chunk failures, and reusing the shared
  runtime after it is ready.
- Fix the exact automated contrast failures found on the production homepage;
  do not otherwise change the warm research-library palette.

## Verification

- Commands to run: focused homepage Vitest targets, `pnpm --dir apps/web
  typecheck`, `pnpm --dir apps/web build`, and repo-local Playwright/browser
  captures for the homepage catalog studies.
- Expected outcomes: all focused checks pass, output assets are substantially
  smaller, and desktop/mobile renders retain the current layout and content.

## Results so far

- Seven 128-by-128 AVIF derivatives total about 34 KiB on disk. Production-
  browser page loads requested 10-18 KiB of avatar data and made no request for
  the replaced homepage PNG/JPEG URLs.
- The homepage authentication runtime stays unloaded after five idle seconds
  and starts loading on the existing pointer/focus intent path. An auth dialog
  opened before that load finishes remains on the standalone owner for its
  whole session; after close, the ready shared runtime is adopted. A transient
  import failure is contained and retried on later intent.
- The hero auto-scroll now runs after paint without reading `scrollHeight` in
  its write path, with a regression assertion for the maximum scroll target.
- Axe color-contrast checks reported zero violations at both 1440px desktop and
  390px mobile. Native-resolution catalog crops preserved the existing layout
  and avatar framing.
- Focused Vitest passed 26 tests across six files; scoped ESLint passed; the
  official Web production build, including Web typechecking and trace checks,
  passed.
- ReviewGPT final round 1 identified the open-session replacement and import-
  rejection risks in the first auth-loading implementation. The accepted fix
  now has direct delayed-load, close-and-adopt, and failure-and-retry coverage;
  final round 2 passed with no qualifying findings.
- The preliminary specialist pass then identified a cold-load accessibility
  gap: the pending dialog had no loading semantics and focus escaped when the
  usable form arrived. The dialog now owns a reduced-motion-safe live loading
  status and conditional focus restoration that leaves a chosen Close control
  alone. Production-browser proof passes on desktop and mobile for keyboard
  activation, focus continuity, Tab, Shift+Tab, Escape, and shared-runtime
  reopen; the remediation is pending its required next final round.
- The required Claude UI double-check could not start because the `claude`
  executable is absent; both prescribed model commands failed with `command not
  found`, so no Claude verdict is claimed.
- Public screenshot hosting is unavailable because the Cloudflare Images
  account setting is absent. The redacted local PNGs remain available for the
  exact-head ReviewGPT package and are not committed.
- Changelog: added a compact improvement item for the materially faster and
  more accessible public homepage, with PR source attribution and a direct
  homepage link.
