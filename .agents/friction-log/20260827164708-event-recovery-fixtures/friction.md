---
title: 'Event recovery fixtures omit required note payload'
severity: 'minor'
---

## Expected Behavior

Focused event identity and CLI error-mapping tests should reach the behavior they claim to exercise and keep the required package coverage shards green.

## Current Behavior

Two synthetic fixtures declare an event with `kind: "note"` but omit the contract-required `note` field. Event contract validation fails before the identity-precedence or mocked error-mapping boundary. The CLI assertion also expects arbitrary core error details to survive mapping even though event contract failures intentionally replace them with a bounded validation context. Together, these stale expectations block the core and CLI package coverage shards.

## Possible Solution

Keep the fixtures contract-valid by supplying a synthetic note value wherever the test intends to exercise a later boundary, and assert the established bounded validation context for event contract failures.

## Minimal Reproducible Example

Run the focused canonical-id precedence test or the focused renamed-error mapping test on the affected main revision. The former fails before its identity assertion. The latter first fails validation, then—once its fixture is valid—rejects its stale expectation that a private-shaped arbitrary detail is preserved.

## Context

The failures block otherwise unrelated pull requests whose merge-result CI includes the affected main revision.
