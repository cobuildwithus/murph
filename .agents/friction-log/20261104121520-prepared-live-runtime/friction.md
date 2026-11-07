---
title: 'Prepared live runtime omits the production CLI prompt contract'
severity: 'minor'
issue: 'cobuildwithus/murph#4551'
---

## Expected Behavior

A production-capability live fixture either includes the generated CLI surface contract shipped in the hosted runner or fails before a provider call.

## Current Behavior

`pnpm build:test-runtime:prepared` builds the CLI but omits `cli-surface-contract.generated.json`. Source-mode assistant planning silently returns a null bootstrap contract. The resulting live developer instructions omit roughly six kilobytes of production command guidance, making capability comparisons incomplete.

## Minimal Reproducible Example

In a fresh task checkout, install dependencies and run `pnpm build:test-runtime:prepared`. Inspect `readAssistantCliSurfaceBootstrapContext()` before and after `node scripts/assemble-assistant-cli-surface.mjs`; the latter supplies the missing contract used by hosted packaging.

## Possible Solution

The production-capability fixture now rejects a missing contract with the exact generation command. Consider including assembly in the prepared live-runtime entrypoint when full prompt parity is requested.

## Context

Test-only hosted reproduction needs the production prompt composition as well as dynamic tool schemas. No provider call or production data is necessary to demonstrate the gap.
