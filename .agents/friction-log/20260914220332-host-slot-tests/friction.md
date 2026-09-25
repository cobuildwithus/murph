---
title: 'Host-slot tests inherit the acceptance runner slot marker'
severity: 'minor'
---

## Expected Behavior

The shared-host slot tests should exercise their isolated test state roots when run through canonical acceptance, as they do when invoked directly.

## Current Behavior

Acceptance exports MURPH_VERIFY_HOST_SLOT_HELD=1 to child commands. The slot test harness removes other admission variables but retains this marker, so its child wrappers bypass admission. Seven slot tests fail inside acceptance even though the selected automatic-admission case passes without the inherited marker.

## Minimal Reproducible Example

Run `MURPH_VERIFY_HOST_SLOT_HELD=1 pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/run-with-host-verification-slot.test.ts -t 'automatically admits Codex commands'`. Repeat with the marker set to an empty string. The former fails and the latter passes.

## Possible Solution

Clear the inherited held-slot marker in the test harness default environment, while preserving explicit per-case overrides for reentrant admission tests.

## Context

The canonical direct-main acceptance command reaches these tests under its own acquired host slot. Both the test and admission implementation were unchanged by the candidate being verified.
