---
title: 'Host-support bundle proof races a moving pull-request base'
severity: 'minor'
issue: 'cobuildwithus/murph#2387'
---

## Expected Behavior

A pull-request host-support run should prove and test one coherent candidate assembled from the event's exact base and head revisions.

## Current Behavior

The production bundle job fetches the mutable pull-request merge ref, then compares that merge commit's first parent with the immutable base revision stored in the triggering event. If the default branch advances between those operations, the pre-build revision assertion fails. Rerunning the same event cannot repair the mismatch, and even a fresh Ready event can lose the same race.

## Possible Solution

Use the checked-out exact candidate's first parent as the bundle baseline while retaining the exact candidate and pull-request head checks. Do not compare that parent with the event's older base snapshot.

## Minimal Reproducible Example

1. Open a synthetic pull request and trigger the host-support workflow.
2. Advance the default branch before the production bundle job fetches the pull-request merge ref.
3. Observe that the candidate first parent differs from the event base and the job exits before installing dependencies or building a bundle.

## Context

This blocked verification of an unrelated assistant prompt-scope change and forced an ineffective Ready-event refresh while every patch-specific focused check remained green.
