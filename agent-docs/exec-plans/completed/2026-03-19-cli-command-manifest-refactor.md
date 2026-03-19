# 2026-03-19 CLI Command Manifest Refactor

## Goal

Introduce one primary descriptor source for the Healthy Bob CLI command topology plus CLI-facing service bindings, replace manual root registration choreography in `packages/cli/src/vault-cli.ts`, and materially shrink the mirrored unwired-service wiring in `packages/cli/src/usecases/integrated-services.ts` without changing external CLI behavior.

## Scope

- `packages/cli/src/vault-cli.ts`
- `packages/cli/src/usecases/integrated-services.ts`
- `packages/cli/src/health-cli-descriptors.ts`
- `packages/cli/src/commands/health-entity-command-registry.ts`
- New CLI manifest/helper files under `packages/cli/src/`
- Targeted CLI tests covering descriptor/topology parity
- `packages/cli/src/incur.generated.ts` only if command topology output changes

## Constraints

- Preserve all existing command names, help semantics, result envelopes, and runtime behavior.
- Keep the descriptor model small and readable; no meta-programming-heavy command DSL.
- Reuse the existing health descriptor pattern as the precedent and fold health commands into the broader manifest rather than creating a separate registry style.
- Avoid broad edits inside command implementation modules unless a narrow export/helper is required for the manifest.
- Keep assistant/inbox/generated-command overlap safe with the active non-exclusive CLI lanes already recorded in the coordination ledger.

## Plan

1. Add a unified command-manifest descriptor layer that can describe registered root commands and their CLI-facing service bindings, including adapted entries for health CRUD commands.
2. Rewire `createVaultCli()` to iterate the manifest in the current registration order.
3. Replace the manual unwired service mirror with helper-driven stub generation derived from the integrated service objects and/or manifest-declared bindings.
4. Add parity tests that fail when the live CLI root command topology or declared CLI-facing service bindings drift from the descriptor source of truth.
5. Regenerate `packages/cli/src/incur.generated.ts` only if topology changes, then run required checks plus completion-workflow audit passes before handoff.

Status: completed
Updated: 2026-03-18
Completed: 2026-03-18
