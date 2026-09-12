---
title: 'Wearable persisted-page proof ignores failed navigation responses'
severity: 'minor'
---

## Expected Behavior

The wearable browser proof must reject a failed page load before inspecting connection state and identify whether initial navigation or reload failed.

## Current Behavior

Both response objects are discarded. A synthetic HTTP 503 page with connected markup passes the proof. An empty error page instead waits for the full connection-state deadline, hiding the navigation failure. A redirect to another same-origin page can also pass with matching markup.

## Minimal Reproducible Example

Route the synthetic browser origin's `/connect` response to HTTP 503 with a Garmin heading and a visible connected-state marker. Invoke the existing persisted-page journey. It resolves instead of rejecting the failed response. Repeat with only the reload returning 503 or with a redirect to a synthetic sign-in page containing the same markup.

## Context

This weakens browser proof and delays diagnosis. Keep the existing status, reload, canonical-data, and cleanup assertions while validating the page boundary first.
