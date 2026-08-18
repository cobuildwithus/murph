---
title: 'Diagnostics test fixture bypasses the marked Vitest temp root'
severity: 'minor'
---

## Expected Behavior

Every test-owned assistant state, operator home, and vault path should live under the marked per-run Vitest temp root so focused and concurrent runs cannot observe one another's persisted state.

## Current Behavior

The hosted workspace assistant diagnostics fixture hardcodes three shared system-temp paths. A focused rerun can therefore read incompatible persisted state left by another run and fail before reaching the behavior under test.

## Possible Solution

Resolve all three synthetic roots from `MURPH_VITEST_TEMP_ROOT`, failing closed when the repository's global test setup is absent.

## Minimal Reproducible Example

1. Leave a synthetic pending-input state with an unsupported field under the fixture's shared vault path.
2. Run only the hosted workspace assistant diagnostics test.
3. Observe parsing fail on the unrelated persisted field before the diagnostics assertions run.

## Context

This blocked focused verification of a callback-module mock correction discovered by the platform coverage shard.
