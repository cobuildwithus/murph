---
title: 'WHOOP headed smoke expects the retired authorization error message'
severity: 'minor'
---

## Expected Behavior

The headed browser smoke should require the fixed authorization action and location categories while proving that page content and raw provider subdomains stay out of failure messages.

## Current Behavior

The shared browser helper now includes fixed diagnostic categories when an authorization click fails. The WHOOP headed smoke still expects the older category-only message, so the viewport CI job fails before checking layout.

## Minimal Reproducible Example

Run the headed browser smoke with its synthetic WHOOP consent button covered by an overlay. The timeout contains the fixed whoop_grant action and whoop.com/other location categories, while the assertion still requires only the timeout category.

## Context

Update the exact expected diagnostic message and preserve both private-content and raw-subdomain rejection assertions. This is test-only follow-up to the shared browser failure-evidence change.
