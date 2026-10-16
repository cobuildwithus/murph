---
title: 'Auth design browser proof has incomplete provider fixtures and a stale records selector'
severity: 'minor'
issue: 'cobuildwithus/murph#4166'
---

## Expected Behavior

The auth adoption browser proof should isolate all provider calls and reach current disclosure controls deterministically.

## Current Behavior

The phone/email product-loading retry scenarios do not stub eager Telegram preparation or its SDK. Blocking the SDK can replace the Telegram button before the test asserts its label. The unrelated records action-size scenario clicks Disconnect without first opening the current Manage disclosure.

## Possible Solution

Provide synthetic Telegram preparation and SDK responses in the existing shared test setup, abort unhandled API traffic, and open Manage before testing Disconnect. These proof-only corrections accompany the catalog isolation change; no production controller change is needed for these failures.

## Minimal Reproducible Example

Run the existing pr-better-auth-adoption-design-proof.spec.ts through the Web Playwright configuration with its synthetic smoke environment. The retry scenario can fail on the missing Telegram button, and both records scenarios time out before Disconnect.

## Context

Detected while preserving real authentication journey proof after removing live controllers from the inert public catalog. The popup and cancellation scenarios retain their own explicit provider behavior overrides.
