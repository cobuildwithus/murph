---
title: 'ReviewGPT same-thread replacement artifact downloads the earlier attachment'
severity: 'minor'
---

## Expected Behavior

After a waited follow-up response creates a replacement patch in the same ChatGPT thread, thread export and thread download should address the assistant-owned artifact from that latest response.

## Current Behavior

The waited capture reports the replacement response and its new patch digest, but a fresh thread export exposes only the earlier assistant response. Downloading several artifact indexes returns the earlier patch bytes, while selecting the replacement button text times out.

## Possible Solution

Persist the exact assistant response node and artifact identifiers in the waited capture result, and let thread download select that response explicitly instead of rediscovering the default visible branch.

## Minimal Reproducible Example

1. Send one repository review request and let the assistant attach patch A.
2. In the same thread, send a correction request and let the assistant attach replacement patch B under the same filename.
3. Confirm the waited response reports patch B.
4. Export the thread and download artifact indexes from the latest request.
5. Observe that export and download still resolve patch A.

## Context

This blocks safe application of an assistant-authored correction because the captured response and downloaded artifact disagree. The workaround is another same-thread response that emits the unified diff inline for manual inspection.
