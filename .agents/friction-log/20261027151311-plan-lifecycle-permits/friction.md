---
title: 'Plan lifecycle permits reuse of a completed plan filename'
severity: 'minor'
issue: 'cobuildwithus/murph#4394'
---

## Expected Behavior

Opening or closing a plan must preserve an existing completed plan with the same date and slug.

## Current Behavior

The open helper creates an active plan even when its completed destination already exists. The finish helper then overwrites that historical file.

## Minimal Reproducible Example

In an isolated checkout, complete a synthetic plan, reopen the same slug on the same date, and finish the second plan. The completed path is replaced instead of rejecting the collision.

## Possible Solution

Check both active and completed destinations at creation and fail closed before moving onto an existing completed file.

## Context

A repeated diagnostic task needed a distinct plan filename and restoration of the historical file before publication.
