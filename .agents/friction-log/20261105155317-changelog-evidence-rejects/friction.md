---
title: 'Changelog evidence rejects deleted entry references'
severity: 'minor'
---

## Expected Behavior

A PR that deletes an existing changelog fragment can declare that item's original date and stable ID.

## Current Behavior

The validator looks only at the candidate registry and rejects the deleted item as unknown. Declaring the deletion not applicable is also rejected.

## Possible Solution

Validate deleted fragment references against their merge-base contents while continuing to reject invented IDs and dates.

## Minimal Reproducible Example

Delete a committed synthetic changelog fragment and declare its original date and item ID under Changelog: updated. Run the PR changelog validator against the base and head commits.

## Context

This blocks truthful evidence for intentional historical content removal.
