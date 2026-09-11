---
title: 'Hosted reminder admission observer excludes its accepted runtime owner'
severity: 'minor'
---

## Expected Behavior

The reminder and device-sync non-starvation scenario should count the runtime owner accepted by its own wake, plus every distinct replacement admitted during the full observation window.

## Current Behavior

The observer discards starts from the hosted-local wake helper even though the scenario accepts that helper's started or woken result. A correctly coalesced runtime owner can therefore leave the observer waiting for a redundant fresh start while the test itself holds checkpoint publication.

## Minimal Reproducible Example

Run the synthetic reminder/device-sync scenario with a directly accepted runtime owner and retain that owner through the checkpoint barrier. The admission log has the helper prefix, so the existing observer reports no accepted attempts instead of counting the active owner once.

## Context

This is a test-observation mismatch. The proof must retain the full admission window, reject replacement owners, and preserve the actual scheduled reminder and device backlog outcomes.
