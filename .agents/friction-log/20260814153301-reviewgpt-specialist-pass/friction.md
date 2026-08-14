---
title: 'ReviewGPT specialist pass cannot attest fast completed reviews'
severity: 'minor'
---

## Expected Behavior

A completed preliminary specialist response with the exact attachment, requested model evidence, required markers, and substantive lens coverage should have a usable recovery path when it finishes below the duration trust floor.

## Current Behavior

On a small prompt-primary pull request, the configured model can return a marked, substantive specialist verdict in about one minute. The wrapper rejects it solely because it is below the five-minute floor. Repeated continuations in the same owned thread return the same complete verdict at the same speed, so they cannot become attested. An alternate managed browser cannot necessarily continue the owner profile's thread.

## Possible Solution

Permit a bounded same-thread recovery that can attest exact-model, exact-attachment substantive responses without depending only on elapsed generation time, or provide a supported way for the owner thread to request a longer verification phase before the completion marker.

## Minimal Reproducible Example

1. Open a small prompt-primary pull request with product, prompt, and coverage lenses applicable.
2. Run `pnpm review:gpt completion-specialists --wait --response-marker SPECIALIST_REVIEW_COMPLETE` against its clean pushed head.
3. Let the configured model return all required markers and a substantive lens verdict in roughly one minute.
4. Observe that the wrapper rejects the response as untrusted because it is below five minutes.
5. Continue the same owned thread with a deeper path-tracing request and observe the same fast rejection.

## Context

The code, focused verification, exact-head CI, and independent final review can all be complete while the mandatory preliminary gate remains impossible to attest. Repeating the accepted review prompt wastes model and browser capacity without producing stronger evidence.
