---
title: 'Wearable browser readiness conflates transport and connect navigation'
severity: 'minor'
---

## Expected Behavior

Remote browser transport readiness should probe the existing lightweight health endpoint. Once transport is ready, the connect page should use the normal browser navigation budget.

## Current Behavior

The readiness loop navigates directly to the connect page with a five-second attempt limit and reports every navigation failure as a tunnel failure. A reachable server with a slower connect response is indistinguishable from an unavailable tunnel.

## Possible Solution

Probe the fixed same-origin health endpoint through the browser, require HTTP 200 within the existing transport deadline, and then navigate once to the connect URL using the normal configured navigation timeout. Keep failure diagnostics content-free.

## Minimal Reproducible Example

Use a local HTTP server that returns health immediately but delays every connect response for six seconds. Drive it with real Chromium through the existing readiness helper. Transport is available, but the connect navigation repeatedly exceeds the five-second probe budget.

## Context

This confuses test-harness diagnosis and prevents the browser journey from reaching its provider and canonical-data assertions. No provider credentials or live provider requests are needed for the reproduction.
