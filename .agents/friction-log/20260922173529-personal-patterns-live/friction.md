---
title: 'Personal Patterns live timing assertion rejects hyphenated next-day wording'
severity: 'minor'
---

## Expected Behavior

The focused real-model Pattern journey should accept ordinary next-day wording when it accurately identifies the outcome timing.

## Current Behavior

The timing regex accepts a space after next but rejects a hyphen, causing an otherwise valid synthetic journey to fail after provider work. The adjacent baseline regex also rejects the ordinary phrase `confirmed no yard work`.

## Possible Solution

Accept either separator and the explicit `no` baseline wording while retaining the outcome timing, count, baseline, single-finding and ledger assertions. Fixed in this task.

## Minimal Reproducible Example

The old regex `/next (?:day|morning)/iu` rejects the synthetic phrase `next-day HRV`.

## Context

Focused assistant live verification. No production evidence or private transcript is needed to reproduce this assertion bug.
