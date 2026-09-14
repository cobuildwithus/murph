# Reduce device-settings complexity

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

Reduce concentrated branching in `apps/web/src/lib/device-sync/settings-surface.ts` while preserving accepted inputs, outputs, diagnostics, ordering and existing ownership.

## Evidence and owner

The repository analyzer at base `56b9f3751977b5b6745269f1a444559d5ef91ce0` reports buildConnectedSource at complexity 87. The existing module remains the implementation owner. No schema, authority, state or deployment contract changes are intended.

## Approach

Inspect the implementation patch, prioritize deleted repetition and existing primitives, and use narrowly named same-file helpers only for real responsibilities. Preserve failure and retry behavior. Record both excess-over-20 debt and total complexity to distinguish factoring from branch deletion.

## Tasks

1. Inspect the proposed patch and callers; confirm behavior preservation.
2. Run focused owner tests, relevant typecheck, differential proof where useful, and the complexity guard.
3. Review the complete diff, close this plan in the scoped commit, and open a draft PR with concrete evidence.
4. Mark the stable candidate Ready; start final ReviewGPT concurrently with required exact-head CI and resolve the completion gates.

## Verification

- Replaced eight duplicated connection-field projections with one local commonSource object. State-specific messages, actions, flags and reconnect-target overrides remain explicit. Source: +30/-139 lines.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/device-sync-settings-surface.test.ts --no-coverage`: 28 tests passed.
- `pnpm --dir apps/web typecheck`: passed.
- Temporary base/head differential harness: all 4,860 synthetic full projections match, including lifecycle state, setup expiry, sync/error timestamps, upstream recovery and target availability.
- `pnpm complexity:diff --base HEAD`: passed. Maximum 87 -> 63; excess-over-20 debt 67 -> 43; total complexity also falls 24. No function extraction.
- Parent candidate review: only shared DTO field construction changes; no new I/O, state, schema, authority, public API, provider input or deployment protocol. Existing source-label and recovery helpers remain the owners. Product UX Ready for unchanged projected behavior; no component markup, styles or handlers change.
- Changelog: not applicable for this internal behavior-preserving refactor. Required exact-head CI and final ReviewGPT are tracked on the PR after the stable commit.
Completed: 2026-09-14
