---
title: 'Garmin browser canary validates consent controls before navigation settles'
severity: 'minor'
---

## Expected Behavior

The live Garmin browser canary should wait for the exact consent route and its exact control surface to settle before validating or acting.

## Current Behavior

The canary validates the checkbox count immediately after the selection URL appears. During an in-flight provider navigation, the URL and DOM can briefly describe different surfaces, causing an otherwise valid run to fail before the existing authorization loop can observe the settled route.

## Possible Solution

Use the existing bounded provider-progress window to observe the exact consent controls and re-read the route before failing closed.

## Minimal Reproducible Example

Model the Garmin selection URL with zero checkboxes for one observation interval, then transition the page to either the exact three-checkbox surface or another trusted provider route. The runner currently throws on the first observation.

## Context

This makes the protected Garmin E2E canary intermittent even though the same exact commit can complete callback, reload, and disconnect cleanup successfully.
