---
title: 'Interactive HTTPS preview omits authenticated backend'
severity: 'minor'
---

## Expected Behavior

The documented HTTPS preview starts every service required to sign in and open Browser Vault data.

## Current Behavior

The preview can start the Web server and Worker with different internal Web ports or crypto state. Authentication can open, but sign-in or signed-in data requests then fail.

## Possible Solution

Document the supported worker-only profile as the third long-lived preview process. Pass the Web host and port to that profile. Load its generated crypto state in the Web process, and require a signed-in data-page check.

## Minimal Reproducible Example

1. Start the documented HTTPS preview.
2. Sign in with a synthetic local account.
3. Open a Browser Vault data page.
4. Observe that sign-in fails when Web and Worker keys differ, or that the page cannot load when the Worker calls the wrong Web port.

## Context

This causes repeated false-positive preview handoffs. A working auth dialog does not prove that authenticated product data works.
