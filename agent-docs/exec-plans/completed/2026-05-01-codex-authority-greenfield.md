# Codex Authority Greenfield Patch

## Goal

Land the supplied greenfield Codex-authority patch intent on the current checkout: remove hosted hard-coded Codex model defaults, keep hosted assistant readiness independent of a model string, and add regression coverage so Murph does not reintroduce hosted model authority or pre-Codex device-connect interception.

## Constraints

- Preserve unrelated dirty work and active ledger rows.
- Treat the supplied patch as behavioral intent because it is stale against the current checkout.
- Do not reintroduce Murph-owned hosted Codex model defaults.
- Keep hosted shell env inheritance at `none` unless an explicit future task changes that contract.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/operator-config/src/hosted-assistant-config.ts`
- `packages/assistant-engine/test/codex-authority-hard-cut.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- `packages/operator-config/test/hosted-assistant-bootstrap.test.ts`

## Verification

- Passed focused and coverage-bearing package tests for the touched runtime, operator-config, and assistant-engine surfaces.
- Security/privacy review passed with no findings.
- Coverage-write added regression coverage for local explicit-model TOML output and null-model readiness.
- Final review findings were fixed: blank model env values are removed from the hosted runtime env, and the ledger row was corrected.
- Package/root typecheck and `test:diff` remain blocked by unrelated `packages/runtime-state/src/hosted-domain-crypto.ts` BufferSource typing errors.
- Root `pnpm test` remains blocked by unrelated core/device-sync failures and a CLI/setup prompt hang.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
