---
title: 'Stripe checkout fixture failures discard diagnostic output'
severity: 'minor'
---

## Expected Behavior

The hosted-local Stripe matrix should preserve a bounded, privacy-safe indication of the fixture step and HTTP or process failure so the failing boundary can be investigated.

## Current Behavior

The official fixture child uses ignored output. A nonzero exit produces only a generic failure, losing which of the three fixed fixture steps ran and whether Stripe returned an HTTP rejection.

## Minimal Reproducible Example

Replace the fixture child with an inert synthetic process that writes a fixed payment_page_confirm progress line and a synthetic HTTP 400 failure, then exits 1. The current helper reports neither the step nor status. Do not call Stripe or include real provider output.

## Possible Solution

Project only finite fixture step names and bounded numeric statuses into the existing sanitized error. Drain bounded in-memory output without printing or persisting raw child text.

## Context

This prevents diagnosis of scheduled billing proof failures. Production billing logic, fixture requests, time budgets and release gates must remain unchanged.
