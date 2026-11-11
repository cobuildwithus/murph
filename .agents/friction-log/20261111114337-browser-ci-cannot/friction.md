---
title: 'Browser CI cannot use installed libraries during an Ubuntu mirror outage'
severity: 'minor'
---

## Expected Behavior

Browser verification runs on an ephemeral Ubuntu runner when the pinned Chromium and its existing native libraries can launch successfully.

## Current Behavior

The shared Chromium installer requires an APT dependency installation before checking its existing runtime. A confirmed upstream Ubuntu DNS outage repeatedly stops billing and viewport jobs before browser tests, even though the runner already includes browser libraries. Retrying the same source does not address an ongoing mirror outage. A fallback after APT also remains unreachable when the overall step timeout expires first.

## Possible Solution

Download the pinned browser independently and require successful headed and headless launches under Xvfb before continuing. Invoke dependency repair only after a failed runtime probe, then require the same probe to pass. Keep ordinary browser tests and the overall timeout mandatory; missing runtime libraries or a failed download must still fail.

## Minimal Reproducible Example

Run the shared installer with an unavailable Ubuntu package mirror. Its existing dependency command exits before Chromium or the browser tests run. The focused wrapper tests simulate that failure and distinguish usable libraries, failed downloads and failed browser launches.

## Context

The upstream incident is tracked at https://github.com/actions/runner-images/issues/15296. This is CI installation resilience, with no production dependency or runtime behavior change.
