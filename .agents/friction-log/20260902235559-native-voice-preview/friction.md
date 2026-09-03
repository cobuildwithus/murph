---
title: 'Native voice preview URLs inherit non-playable development origins'
severity: 'minor'
---

## Expected Behavior

Native companion onboarding should return voice preview URLs that AVFoundation can stream in every supported environment.

## Current Behavior

The onboarding projection derives voice asset URLs from the incoming request origin. A development tunnel can return the MP3 successfully over HTTP while AVPlayer rejects the same URL as unavailable, leaving the preview control apparently playing without sound.

## Possible Solution

Project immutable public voice assets from the canonical product origin and cover that contract independently from request-origin contact actions.

## Minimal Reproducible Example

1. Request the companion onboarding catalog through a development tunnel.
2. Fetch a returned voice preview URL with an HTTP client and observe a valid ranged MP3 response.
3. Give that URL to AVPlayer and observe a resource-unavailable failure before playback advances.

## Context

This makes HTTP-only route checks misleading and blocks physical-device voice selection testing.
