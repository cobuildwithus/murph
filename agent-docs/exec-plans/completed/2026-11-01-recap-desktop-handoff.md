# Recap desktop iPhone handoff

## Outcome and boundaries

The public recap route currently always offers a custom-scheme link, which cannot
open Murph on a computer. Keep the existing Apple mobile handoff; all other
visitors get the canonical universal link as a server-rendered QR code and the
owner-approved instruction. Preserve ID validation, generic metadata, and the
absence of game reads. No member messages or production data are involved.

## Implementation and Product UX

The existing route owns User-Agent selection. The existing view owns presentation;
use one registry QR encoder because the repository has none. No client detection,
external image service, state, or additional API is needed. iPhone/iPad/iPod and
recognizable Macintosh + Mobile Safari UAs retain the app action. Desktop,
Android, and absent UAs get the QR. Indistinguishable desktop iPad UAs cannot be
identified without client signals and keep the QR fallback.

Entry: a recap link opened from chat. Desktop visitors scan the code with their
iPhone camera; Apple mobile visitors keep Open in Murph. Both retain the App
Store fallback. Light and dark desktop views must keep black modules, white
quiet zone, and the exact requested copy. Invalid IDs still return 404.

## Verification and delivery

- Focused recap and changelog tests, Web typecheck, lint, dependency guards/audit.
- Real route browser proof with JavaScript disabled, Apple mobile UA, desktop
  light/dark, invalid ID, and production component study.
- Inspect and attach safe screenshots; parent review and complexity diff.
- Draft PR, stable candidate Ready, ReviewGPT concurrent with exact-head CI.
- Verify findings, merge after gates, identify Vercel deployment and check the
  canonical page with desktop and iPhone UAs.

Web-only rendering is independently deployable and reversible with no schema or
native changes. Existing universal-link handling stays with the native app.

## Progress

- Implementation complete. Product UX: Ready. Desktop light/dark and Apple
  mobile match the requested views; no-JavaScript browser proof passes.
- Recap/changelog Vitest: 22 passed. Web typecheck and focused lint passed.
  Complexity guard: no hotspots. Dependency policy and ignored-build checks pass.
- Native Vision decoded both rendered desktop screenshots to the exact canonical
  synthetic recap URL. Screenshots were inspected and contain only synthetic UI.
- Dependency audit reports three existing highs (deepmerge-ts, zod,
  follow-redirects); the lockfile changes only add qrcode-generator 2.0.4.
- Fixed a pre-existing not-found heading assertion in the recap browser spec;
  both Playwright tests pass. Task-owned Frog entry records the stale assertion.
- Preview build, ReviewGPT, exact-head CI, merge, and production check remain
  delivery gates owned by this session.
Status: completed
Updated: 2026-11-01
Completed: 2026-11-01
