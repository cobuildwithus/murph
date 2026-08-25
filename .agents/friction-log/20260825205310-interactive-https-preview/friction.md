---
title: 'Interactive HTTPS preview omits authenticated backend'
severity: 'minor'
---

## Expected Behavior

The documented HTTPS preview starts every service required to sign in and open Browser Vault data.

## Current Behavior

The preview starts only the Web server and HTTPS proxy. Authentication can open, but signed-in data requests fail because the local Worker is absent.

## Possible Solution

Document the supported worker-only profile as the third long-lived preview process and require a signed-in data-page check.

## Minimal Reproducible Example

1. Start the documented HTTPS preview.
2. Sign in with a synthetic local account.
3. Open a Browser Vault data page.
4. Observe that the page cannot leave its loading or error state because port 8787 is not served.

## Context

This causes repeated false-positive preview handoffs. A working auth dialog does not prove that authenticated product data works.
