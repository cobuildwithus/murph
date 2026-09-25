---
title: 'Vault-share sleep timestamp test expires with its fixed fixture date'
severity: 'minor'
---

## Expected Behavior

The route test for preserving source-recorded sleep timestamps stays deterministic over time.

## Current Behavior

The test sends fixed July records through a route with a rolling 60-day retention window. Once the wall clock advances past that window, the route correctly filters the records and the timestamp-preservation assertion fails before it can exercise its intended behavior.

## Possible Solution

Pin Date.now within this test to a time when its fixed records are eligible and restore the spy after the test.

## Minimal Reproducible Example

Run the vault-share deliver route test after the fixture's 60-day retention deadline. The expected two records become an empty delivered list.

## Context

This causes unrelated pull requests to fail the required release Web test shard. Production retention behavior should remain unchanged.
