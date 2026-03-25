# setup/onboard channel orchestration refactor

Status: completed
Created: 2026-03-26
Updated: 2026-03-26

## Goal

- Remove duplicated per-channel setup orchestration in `packages/cli/src/setup-services/channels.ts` by driving Telegram, Linq, and email setup through shared flow plus channel-specific specs, while keeping setup outcomes and user-facing semantics unchanged.

## Success criteria

- The repeated setup flow for managed channels is centralized behind one shared orchestration path with channel-specific discovery, provisioning, readiness, and message hooks.
- Internal state names make connector presence, connector enablement, readiness, and missing-env conditions explicit instead of overloading `configured`.
- Returned `SetupConfiguredChannel` objects preserve the current shape, message semantics, and auto-reply enablement behavior for iMessage, Telegram, Linq, and email.
- Existing setup-channel and setup-CLI regression coverage stays green, with new assertions only if they are needed to lock preserved behavior during the refactor.

## Scope

- In scope:
  - `packages/cli/src/setup-services/channels.ts`
  - focused test updates in `packages/cli/test/setup-channels.test.ts` and `packages/cli/test/setup-cli.test.ts`
- Out of scope:
  - changing setup result shapes or assistant automation persistence behavior
  - changing readiness probe policy or user-facing setup copy unless existing tests require a minimal adjustment
  - changing platform filtering or deselection reconciliation semantics

## Risks and mitigations

1. Risk: `configured` and `autoReply` currently encode different internal meanings across channels.
   Mitigation: model explicit internal state first, then map back to the existing public shape at the boundary.
2. Risk: user-visible step details may drift during extraction.
   Mitigation: keep the current strings/spec builders intact and rely on focused setup tests for regression coverage.
3. Risk: setup channel state overlaps other active CLI lanes.
   Mitigation: keep the lane exclusive to `channels.ts` while active and limit edits to the targeted tests.

## Tasks

1. Extract the common managed-channel setup algorithm into shared orchestration helpers with channel specs for Telegram, Linq, and email.
2. Keep iMessage behavior stable while deciding whether it remains separate or uses the shared flow only where it preserves semantics cleanly.
3. Rename internal booleans/state to reflect connector presence, enablement, readiness, and missing-env conditions explicitly.
4. Re-run focused setup-channel/setup-CLI coverage plus required repo verification and report exact outcomes without committing.

## Verification

- Focused: `packages/cli/test/setup-channels.test.ts`, `packages/cli/test/setup-cli.test.ts`
- Required repo checks for `packages/cli`: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
