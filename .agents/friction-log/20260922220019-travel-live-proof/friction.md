---
title: 'Travel live proof compares a local calendar date with serialized UTC'
severity: 'minor'
---

## Expected Behavior

The Journal travel fixture should accept a canonical trip whose projected start represents the requested local calendar day in its recorded timezone.

## Current Behavior

The fixture searches the serialized upcoming-context object for a literal ISO local date. A valid all-day start can serialize to the preceding UTC day and fail before reminder-repair assertions run.

## Possible Solution

Format the projected start using its recorded IANA timezone and assert the resulting calendar date. Keep the canonical record, privacy, patch-count, and repeated-pass assertions.

## Minimal Reproducible Example

A synthetic July 4 all-day plan in Europe/Paris starts at July 3 22:00 UTC. Searching its UTC timestamp for July 4 rejects that valid representation. See the travel-capture journey in packages/assistant-engine/test/assistant-codex-real-e2e.test.ts.

## Context

This fixture mismatch was found while validating morning reminder reconciliation. The task corrects the date assertion without relaxing the expected local day.
