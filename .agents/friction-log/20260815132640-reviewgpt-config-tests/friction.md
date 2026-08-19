---
title: 'ReviewGPT config tests invoke live Spotlight app discovery'
severity: 'minor'
---

## Expected Behavior

ReviewGPT config should use the installed browser without querying host
application indexes, and test harnesses should resolve synthetic lane fixtures
without host discovery.

## Current Behavior

The config performs mdfind lookup for a missing copied lane app before checking
the authoritative installed browser. Repeated subprocesses can spend enough
time in live Spotlight lookup to exceed the focused test timeout.

## Possible Solution

Skip copied-app discovery when the authoritative installed browser already
exists, and stub mdfind in hermetic config harnesses that exercise the fallback.

## Minimal Reproducible Example

Run the focused CLI release-script coverage test on a host with mdfind available and no synthetic named app bundles.

## Context

Adding coverage for another managed browser lane introduced one more config subprocess and exposed the host-dependent timeout.
