---
title: 'Playwright smoke server binds 127.0.0.1 so WebAuthn design proofs cannot use the base URL'
severity: 'minor'
---

## Expected Behavior

A design-proof spec that drives a real passkey control with a Chromium virtual authenticator should be able to open the page through `baseURL` and stub `rp.id` to the served host.

## Current Behavior

`apps/web/playwright.config.ts` fixes `host = "127.0.0.1"`. Chromium rejects an IP address as a WebAuthn relying-party id ("127.0.0.1 is an invalid domain"), so `startRegistration` fails inside the page and the proof only shows a generic alert. Each spec has to rebuild the URL with `localhost` from `test.info().project.use.baseURL` and stub `rpId`/`rp.id` as `localhost`.

## Possible Solution

Serve and health-check the smoke server on `localhost` (or expose a `proofOrigin` helper from the config) so WebAuthn-driving specs can use `baseURL` directly.

## Minimal Reproducible Example

Run `apps/web/e2e/pr-legacy-approval-repair-design-proof.spec.ts` with `page.goto("/screenshots/messages#action-approval-lifecycle")` and `rp: { id: "127.0.0.1" }`; every case fails with the invalid-domain alert.

## Context

Cost one full dev-server cycle while proving the inline approval passkey repair on PR #3504.
