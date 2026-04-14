# Collapse CLI vault selection to one active vault

Status: completed
Created: 2026-04-14
Updated: 2026-04-14

## Goal

- Make `murph` behave as a single-active-vault product surface while leaving `vault-cli` as the raw canonical/dev surface.
- Remove per-command `--vault` switching from normal `murph` usage, add one explicit active-vault selection path, and keep assistant/runtime flows aligned with the single-vault model.

## Success criteria

- `murph` rejects explicit `--vault` overrides for normal vault-backed commands with an actionable error.
- `murph` has one explicit operator path to change the active vault without rerunning the whole onboarding flow.
- `vault-cli` continues to support raw explicit-vault execution for canonical/dev/internal consumers.
- README and architecture/docs explain the new split clearly enough that operator and assistant surfaces stop implying per-command vault switching.
- Focused CLI/bootstrap tests cover the new `murph` behavior.

## Scope

- In scope:
- `packages/cli` bootstrap behavior for `murph` versus `vault-cli`
- `packages/setup-cli` active-vault selection path
- Command/runtime docs that describe active-vault behavior
- Focused CLI and setup tests for the new single-vault product entrypoint
- Out of scope:
- Rewriting raw command schemas to remove `vault` from `vault-cli`
- Reworking internal library/usecase signatures that correctly take explicit vault roots
- Hosted runtime vault resolution changes

## Constraints

- Technical constraints:
- Preserve the canonical raw `vault-cli` contract used by tests, docs, and assistant runtime tooling.
- Avoid hidden runtime fallbacks; fail closed with actionable errors when `murph` has no active vault.
- Product/process constraints:
- `murph` should become the simple operator-facing entrypoint.
- Any architecture-significant runtime-entrypoint change must be documented in durable docs.

## Risks and mitigations

1. Risk: Mixing `murph`-only behavior into shared CLI registration creates drift or breaks raw `vault-cli` consumers.
   Mitigation: Keep the behavioral split in bootstrap/setup routing and leave raw command definitions intact.
2. Risk: Removing ad hoc `--vault` from `murph` leaves no clean way to change the active vault.
   Mitigation: Add one explicit `murph use <path>` selection flow and document it.
3. Risk: Existing tests and help text still imply explicit per-command vault switching.
   Mitigation: Update focused tests plus README/architecture notes in the same change.

## Tasks

1. Add `murph`-specific active-vault policy helpers in CLI bootstrap and route normal commands through a single active vault.
2. Add an explicit `murph use <path>` selection command in setup/onboarding surfaces.
3. Update targeted docs to explain `murph` versus `vault-cli` vault-selection behavior.
4. Add or update focused tests for bootstrap policy, active-vault selection, and error messaging.
5. Run scoped verification, required audit passes, and commit with the active plan.

## Decisions

- Keep `vault-cli` raw and explicit; simplify `murph`, not the canonical low-level command contract.
- Use an explicit active-vault selection command instead of relying on per-command `--vault` overrides in `murph`.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff packages/cli/src/cli-entry.ts packages/setup-cli/src/setup-cli.ts packages/setup-cli/src/setup-services.ts packages/setup-cli/src/setup-services/operator-defaults.ts packages/operator-config/src/operator-config/cli-vault-defaults.ts packages/cli/test/cli-entry.test.ts packages/cli/test/setup-cli.test.ts packages/cli/test/assistant-cli.test.ts README.md ARCHITECTURE.md`
- Focused built/source CLI checks as needed for `murph use` and `murph --vault` rejection paths
- Expected outcomes:
- New `murph` active-vault behavior passes targeted tests and docs match the runtime behavior.
Completed: 2026-04-14
