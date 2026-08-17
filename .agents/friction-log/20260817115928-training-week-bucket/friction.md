---
title: 'Training week-bucket test depends on wall clock'
severity: 'minor'
---

## Expected Behavior

The canonical local-date training test should produce the same week buckets regardless of the calendar date when CI runs.

## Current Behavior

The fixture uses fixed August 2026 workout dates but omits the selector's explicit clock option. Once the real clock advances into the following week, the focused test and the required app-verification shard fail.

## Possible Solution

Pass the selector's existing explicit `now` and `timeZone` options in fixed-date tests that assert relative week positions.

## Minimal Reproducible Example

Run the focused browser training view test on or after 2026-08-17. The fixed 2026-08-09 workout is no longer in the asserted relative week.

## Context

This blocked an otherwise green required pull-request check and reproduced on an unchanged path from the base branch.
