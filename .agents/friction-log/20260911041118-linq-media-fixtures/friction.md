---
title: 'Linq media fixtures advertise a CDN origin rejected by the runner'
severity: 'minor'
issue: 'cobuildwithus/murph#3275'
---

## Expected Behavior

Synthetic PDF, image, and audio attachments should reach the local byte server through an explicitly allowed CDN origin while authenticated metadata calls retain the canonical Linq API boundary.

## Current Behavior

On Linux the fixture config rewrites a loopback CDN URL to the Docker bridge address, which the runtime does not accept as a local CDN override. Canonical API routing also removes the former same-origin metadata fallback. The shared stub derives refreshed byte URLs from the incoming API Host, so media scenarios time out before the download request arrives.

## Possible Solution

Use the existing runner host alias for the shared fixture CDN origin and its metadata download URLs, independently of the incoming API Host. Preserve the production URL allowlist and authenticated API routing.

## Minimal Reproducible Example

Build runner environment from the shared Linq fixture with a synthetic Linux bridge alias, then request attachment metadata through a canonical API Host. Compare the advertised byte URL with the configured runner CDN origin and the runtime's existing local URL validator.

## Context

Hosted media admission needs a focused address-contract regression before the full container scenarios run. Keep attachment metadata and public byte transfer as separate authentication boundaries.
