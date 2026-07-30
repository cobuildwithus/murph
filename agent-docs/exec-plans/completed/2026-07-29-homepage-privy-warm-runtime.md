# Warm homepage Privy runtime after initial render

Status: completed
Created: 2026-07-29
Updated: 2026-07-29
Completed: 2026-07-29

## Goal

- Keep Privy out of the homepage's initial render path while beginning its client
  initialization during browser idle time instead of waiting for the auth dialog
  to open.
- Reuse that exact mounted provider when a landing-page login or signup action
  opens the shared auth dialog.

## Success criteria

- An unauthenticated homepage can paint without importing or mounting Privy.
- The existing homepage idle preload mounts one shared Privy provider after the
  initial render.
- Clicking before idle starts the same runtime immediately and retains the
  existing visible loading fallback.
- Opening the dialog after warmup does not mount a second provider.
- The phone, email, Telegram, and CAPTCHA controls remain unmounted until the
  person explicitly opens authentication.
- An explicit readiness restart remounts the shared provider once and preserves
  the existing bounded recovery behavior.
- Leaving the homepage unmounts the warm provider rather than carrying Privy as
  ambient root authentication state.

## Architecture

- `HomepageAuthRuntimeProvider` lives in the homepage subtree and owns the one
  shared landing-page dialog plus the lazy runtime loader. Navigating away from
  the homepage unmounts both the warm runtime and its provider.
- The root `AuthProvider` remains the owner of ordinary app-wide auth handoffs and
  keeps its existing standalone, intent-mounted Privy island.
- `HostedAuthRuntime` owns the single mounted `HostedPrivyProvider` and exposes
  the existing within-Privy panel plus its explicit restart operation.
- Landing CTAs and the homepage mobile nav use the homepage provider's shared
  dialog. Isolated component/catalog renderers retain their existing standalone
  fallback when that provider is absent.
- Direct non-landing `AuthDialog` consumers keep the existing standalone island,
  so this change does not broaden provider lifetime on invitation, funding,
  settings, or other routes.

## Complexity intentionally avoided

- No root-level eager Privy import or root-lifetime provider.
- No hidden auth form, CAPTCHA, focusable control, second provider, readiness
  queue, durable state, service, or provider-session reconciliation.
- No connection-speed heuristics or additional scheduler; the existing idle
  callback and pointer/focus intent hooks remain the warmup triggers.

## Verification

- Added focused runtime ownership coverage for closed-to-open reuse and explicit
  restart remounting.
- Added shared-dialog coverage proving the warmed runtime panel is used without
  rendering a standalone provider island.
- Added homepage integration coverage for idle warmup and click-before-idle.
- Added a synthetic sections-catalog study documenting the invisible warmup and
  existing early-click readiness state.
- Exact-head CI remains the broad verification owner for the stacked pull
  request.
