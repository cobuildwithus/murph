---
title: 'Native iOS E2E Web builds bypass the production wedge watchdog'
severity: 'major'
---

## Expected Behavior

The dedicated native iOS E2E target should terminate a silent Webpack compile
wedge at the same bounded deadline as the identical production Web build.

## Current Behavior

The build wrapper arms its existing process-group watchdog only when
`VERCEL_ENV=production`. The named `native-ios-e2e` custom environment is a
preview deployment, so a compile with no output can hold the serialized live
lane until Vercel's 45-minute ceiling.

## Possible Solution

Arm the existing 15-minute watchdog when either the deploy is production or
the exact Vercel target is `native-ios-e2e`. Keep ordinary preview, local, and
CI builds unbounded and retain the proven forced-cold Webpack cache policy.

## Minimal Reproducible Example

1. Start a deployment in the `native-ios-e2e` Vercel custom environment.
2. Observe `Creating an optimized production build ...` with no later compile
   output for more than 15 minutes.
3. Confirm the deployment remains `Building` because the preview target did
   not receive `MURPH_VERIFY_HOST_COMMAND_TIMEOUT_MS`.

## Context

The same production Web build already owns a tested whole-process-group
watchdog because warm-cache OOMs and silent compiler wedges previously held
Vercel build slots until the platform ceiling. The native E2E target builds the
same app on the same class of builder and serializes all live acceptance work.
