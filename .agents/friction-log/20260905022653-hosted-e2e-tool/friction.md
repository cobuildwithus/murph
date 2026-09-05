---
title: 'Hosted E2E tool inventory still expects deferred response cards'
severity: 'minor'
---

## Expected Behavior

The hosted E2E advertisement assertion should accept the current code-mode resident tools while requiring deferred discovery.

## Current Behavior

The helper still expects three deferred card tools in the resident inventory. A fixture that models the current tool descriptions fails the helper assertion and blocks the Linq delivery deployment gate.

## Minimal Reproducible Example

In the hosted-local E2E support fixture, omit the response-card, exercise-routine-card, and Telegram rich-content card functions from code-mode descriptions while retaining discovery. Run the hosted-local-e2e-support test: the all-tools scenario fails because the helper expects those three names.

## Context

The runtime already defers these cards. Correct the test inventory and preserve exact tool comparison plus required deferred discovery.
