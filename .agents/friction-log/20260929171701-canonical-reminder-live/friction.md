---
title: 'Canonical reminder live fixture omits the hosted automation port'
severity: 'minor'
---

## Expected Behavior

The canonical reminder create/fire/cancel journey should exercise the current production automation tool and scheduler with synthetic state.

## Current Behavior

The fixture sends its create turn without an execution context or hosted automation port. The current dynamic automation handler requires that port and otherwise returns an unavailable result. The journey fails its first canonical automation-count assertion. It also expects creation through the CLI and a null target override, while current reminder guidance uses the hosted tool and selects a reminder model.

## Possible Solution

Wire the production automation owner to synthetic transport boundaries, and update assertions to the current reminder creation contract without replacing persistence or scheduler behavior with mocks.

## Minimal Reproducible Example

Build the test runtime and run `pnpm test:assistant:live -- --test 'real model canonical reminder create fire and cancel'` with an authenticated local subscription. Inspect `createCanonicalLiveFixture` and `runCanonicalReminderJourney` in `packages/assistant-engine/test/support/canonical-live-journeys.ts`, and the missing-port branch in `packages/assistant-engine/src/assistant-codex/dynamic-tools/automation.ts`.

## Context

This blocks the broad reminder journey during model migration validation. The existing saved-reminder model-upgrade journey exercises the migration boundary separately.


## Resolution

The canonical reminder journey now supplies a synthetic implementation of the
hosted automation port on creation and cancellation, backed by production core
persistence and cron timing. Assertions follow the hosted save/patch contract and
the saved reminder model. Deterministic tests reproduce the missing-port failure,
exercise the real dynamic-tool dispatcher, and verify canonical writes, stale
updates, and cancellation. Full live-model execution is separate proof.
