# Persist wearable onboarding preferences canonically

Status: completed
Created: 2026-04-10
Updated: 2026-04-10

## Goal

- Persist onboarding wearable selections as canonical vault preferences so rerunning onboarding restores the user's choices after runtime wipes or restarts.

## Success criteria

- `bank/preferences.json` gains a canonical wearable-preference field with an explicit schema-version seam.
- Core and vault-usecases expose a narrow read/write seam for wearable preferences without setup-cli reaching into core internals directly.
- Interactive onboarding saves selected wearables canonically and restores them on later runs.
- Explicit empty wearable selections stay empty instead of being treated as missing.
- Focused package tests and one direct scenario proof cover the new persistence path.

## Scope

- In scope:
- canonical preferences contract/core mutation updates for wearable preferences
- vault-usecases seam consumed by setup-cli
- setup-cli onboarding read/write wiring for wearable selections
- focused tests and any required architecture/runtime-doc updates tied directly to this seam
- Out of scope:
- changing device-sync OAuth/account runtime ownership
- adding a new standalone wearable preferences CLI surface unless needed for the setup seam
- broad onboarding UX redesign beyond restoring persisted wearable selections

## Constraints

- Technical constraints:
- canonical user-facing state must not live under `.runtime/**`
- setup-cli should reuse existing workspace package boundaries and avoid direct core ownership bypasses
- Product/process constraints:
- preserve unrelated dirty-tree edits, especially overlapping setup and scheduler lanes
- keep the diff narrow to wearable preference persistence rather than broad settings work

## Risks and mitigations

1. Risk: preference persistence drifts from actual device connection state and confuses the product model.
   Mitigation: store only desired providers canonically and keep real connection/runtime state owned by device-sync.
2. Risk: existing `bank/preferences.json` documents fail reads after the schema expands.
   Mitigation: add backward-compatible normalization for prior schema versions and cover it with tests.
3. Risk: setup still collapses explicit empty wearable selections back to defaults.
   Mitigation: switch the wizard wrapper to explicit `undefined` checks and add a regression test.

## Tasks

1. Extend canonical preferences contracts/core helpers to read and write wearable preferences safely.
2. Add a narrow vault-usecases helper for setup to show and persist wearable preferences.
3. Wire setup-cli to read canonical wearable preferences for wizard initialization and save selections during onboarding.
4. Add focused tests plus direct scenario proof for persisted and explicit-empty behavior.
5. Run required verification/audit workflow and land a scoped commit.

## Decisions

- Canonical wearable intent will live in `bank/preferences.json`; actual connected account/runtime state remains owned by device-sync.
- Setup-cli will depend on a small vault-usecases seam instead of importing core directly.

## Verification

- Commands to run:
- `pnpm test:diff packages/contracts/src/preferences.ts packages/core/src/preferences.ts packages/vault-usecases/src/usecases/preferences.ts packages/setup-cli/src/setup-cli.ts packages/setup-cli/src/setup-services.ts packages/setup-cli/src/setup-services/wearables.ts packages/setup-cli/src/setup-wizard.ts`
- `pnpm typecheck`
- direct scenario proof for setup-cli wearable preference read/write behavior
- Expected outcomes:
- touched-owner coverage or truthful diff coverage passes, typecheck passes, and direct scenario proof shows canonical wearable selections round-trip through onboarding initialization
Completed: 2026-04-10
