---
title: 'Concurrent ReviewGPT packaging can collide on the timestamped audit ZIP'
severity: 'minor'
---

## Expected Behavior

The repository-required preliminary and final ReviewGPT passes should be able to package the same exact PR head concurrently without sharing or removing one another's intermediate artifacts.

## Current Behavior

When both passes start within the same timestamp bucket, they can select the same intermediate audit-package filename. One packager moves the file into its private attachment directory, leaving the other packager to fail before the review is sent.

## Possible Solution

Give each packaging invocation a collision-resistant intermediate filename or write directly into its invocation-owned temporary attachment directory.

## Minimal Reproducible Example

1. Start the preliminary completion-specialists pass and final PR-review round concurrently for the same clean pushed head.
2. Let both runs create their guarded repository snapshot within the same timestamp bucket.
3. Observe that one run succeeds in staging its snapshot while the other cannot move the now-missing shared intermediate ZIP.

## Context

Murph's completion workflow explicitly permits these independent reviews to run concurrently. The collision turns the recommended path into a tooling retry and delays the security-sensitive review gate.
