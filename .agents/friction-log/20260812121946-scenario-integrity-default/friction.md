---
title: 'Scenario integrity default skips documented-command coverage'
severity: 'minor'
---

## Expected Behavior

The local scenario-integrity command used for command-surface changes should detect a documented baseline command that has no matching scenario manifest.

## Current Behavior

The ordinary `pnpm test:scenario-integrity` command checks referential integrity but omits documented-command coverage. The required release fixture job invokes the verifier with `--coverage`, so a locally passing command can still fail CI after a documented CLI signature changes.

## Possible Solution

Expose a named local coverage command in the verification guide, or make the default scenario-integrity script run coverage mode when command-surface documentation changes.

## Minimal Reproducible Example

1. Add a command signature to the documented baseline command block.
2. Run `pnpm test:scenario-integrity` and observe a pass.
3. Run `pnpm exec tsx e2e/smoke/verify-scenario-integrity.ts --coverage` and observe the missing-manifest failure.

## Context

This was found when required CI rejected two newly documented workout CSV command signatures after the ordinary local integrity command had passed.
