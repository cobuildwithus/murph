---
title: 'Local browser session seeding loads production origin restrictions'
severity: 'minor'
issue: 'cobuildwithus/murph#4278'
---

## Expected Behavior

The hosted-local browser smoke test should mint a first-party session against its isolated test database and then exercise the production Web artifact with the expected cookie name.

## Current Behavior

Session seeding copies the production-artifact decision into the in-process seed environment. First-party configuration then rejects the harness loopback mutation origins before the browser journey starts.

## Possible Solution

Keep the in-process session seed in test mode. The existing secureCookieMode option already controls the cookie name supplied to the production Web artifact.

## Minimal Reproducible Example

Run the hosted-web-browser-smoke scenario with the e2e:stub profile and a prepared production Web artifact. Session issuance fails while reading local mutation-origin configuration.

## Context

The release admission browser check cannot reach its authenticated page assertion. Production origin restrictions should remain unchanged.
