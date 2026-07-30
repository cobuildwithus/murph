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

## Architecture

- `AuthProvider` remains the one owner of the global auth dialog and gains the
  lazy runtime loader.
- `HostedAuthRuntime` owns the single mounted `HostedPrivyProvider` and exposes
  the existing within-Privy panel plus its explicit restart operation.
- Landing CTAs use the shared `AuthProvider` dialog in production. Their existing
  standalone path remains only for isolated component/catalog renderers that do
  not have the root provider.
- Direct non-landing `AuthDialog` consumers keep the existing standalone island,
  so this change does not broaden provider lifetime on invitation, funding, or
  other routes.

## Complexity intentionally avoided

- No root-level eager Privy import.
- No hidden auth form, CAPTCHA, focusable control, second provider, readiness
  queue, durable state, service, or provider-session reconciliation.
- No connection-speed heuristics or additional scheduler; the existing idle
  callback and pointer/focus intent hooks remain the warmup triggers.

## Verification

- Added focused runtime ownership coverage for closed-to-open reuse and explicit
  restart remounting.
- Added shared-dialog coverage proving the warmed runtime panel is used without
  loading a standalone provider island.
- Added homepage integration coverage for idle warmup and click-before-idle.
- Exact-head CI remains the broad verification owner for the stacked pull
  request.
