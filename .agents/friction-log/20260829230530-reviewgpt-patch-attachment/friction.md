---
title: 'ReviewGPT patch attachment download times out after response completion'
severity: 'major'
---

## Expected Behavior

A waited ReviewGPT run that returns a patch attachment should download the completed artifact once and make it available for exact hash verification and application.

## Current Behavior

The browser run completed and exposed the attachment, but the downloader repeatedly timed out waiting for a browser download event. The completed artifact bytes were then unavailable to the response-capture path, forcing a second ReviewGPT request to re-encode the patch inline. A later fresh run also failed twice while staging the same repository attachment before a different browser lane succeeded.

## Possible Solution

Capture completed attachment bytes from the response artifact endpoint as a fallback when the browser download event is missed, and retain a bounded invocation-owned copy until response capture confirms artifact recovery.

## Minimal Reproducible Example

1. Run a waited ReviewGPT implementation request with `--artifacts --zip` and ask for a patch attachment.
2. Let the assistant finish with the requested attachment.
3. Observe the downloader time out while waiting for the browser download event even though the attachment exists in the completed response.
4. Attempt exact recovery from the captured response and observe that the attachment bytes are unavailable.

## Context

This blocked exact application of a production-fix patch and required multiple replacement ReviewGPT runs plus an inline gzip/base64 transfer workaround.
