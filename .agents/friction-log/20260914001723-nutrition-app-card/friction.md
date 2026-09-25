---
title: 'Nutrition app-card caption fixture blocks unrelated release package checks'
severity: 'minor'
---

## Expected Behavior

The exact-body Linq runtime fixture should assert the current canonical nutrition-card caption so unrelated behavior-preserving PRs can complete required release proof.

## Current Behavior

The platform-a release package shard fails in the existing http-linq-device-runtime test because its expected daily nutrition caption uses the former date-and-meal wording. The current production renderer produces the newer compact wording. This mismatch is present in the task base and appears on multiple independent PR heads without changes to that package.

## Possible Solution

Update the stale fixture to the current documented renderer contract while preserving the complete outgoing app-card body assertion.

## Minimal Reproducible Example

Run the operator-config http-linq-device-runtime suite and inspect the case named "linq runtime checks iMessage capability and sends the exact one-part app card body". The synthetic daily-nutrition card expectation differs only in its caption wording.

## Context

Required Release checks cannot pass while the unchanged platform-a package shard fails. The complexity refactors passed their relevant focused tests and are separately reviewed; this shared base fixture mismatch prevents merge readiness.
