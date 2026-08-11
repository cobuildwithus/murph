---
title: 'ReviewGPT archive packaging includes obsolete completed execution plans'
severity: 'minor'
---

## Expected Behavior

Parent-built ReviewGPT archives should contain the current code and active task context while excluding obsolete completed execution-plan history.

## Current Behavior

A full repository archive included accumulated completed execution plans and exceeded the bounded attachment size before the parent added a manual exclusion.

## Possible Solution

Make the exclusion a tested archive invariant or provide a shared bounded review-packaging helper.

## Minimal Reproducible Example

Build a full ReviewGPT archive from a repository with substantial completed plan history and compare its contents and size with the review input boundary.

## Context

The Frog autofix parent needs a bounded full snapshot for sensitive reviews. This caused a failed packaging attempt and required a task-local exclusion.
