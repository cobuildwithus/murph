# Capability Registry Runtime Source Of Truth

## Goal

Make the bound assistant tool catalog the single provider-turn availability source of truth while keeping capability normalization, dedupe, and host binding on one registry-driven path.

## Scope

- `packages/assistant-core/src/model-harness.ts`
- `packages/assistant-core/src/inbox-model-contracts.ts`
- `packages/assistant-core/src/inbox-model-harness.ts`
- `packages/assistant-core/src/assistant-cli-tools/shared.ts`
- `packages/assistant-core/src/assistant-cli-tools/catalog-profiles.ts`
- `packages/assistant-core/src/assistant/provider-turn-runner.ts`
- `packages/assistant-core/src/assistant/providers/types.ts`
- `packages/assistant-core/test/assistant-hosted-device-connect-tool.test.ts`
- `packages/cli/test/assistant-harness.test.ts`
- `packages/cli/test/assistant-service.test.ts`
- `packages/cli/test/inbox-model-harness.test.ts`

## Constraints

- Preserve existing assistant tool names and bound-catalog behavior.
- Keep host preference and fallback semantics unchanged for live tools.
- Remove only unused host/runtime seams; do not invent a new host abstraction.
- Avoid speculative API expansion; land the smallest change that removes the remaining availability drift.

## Plan

1. Switch provider-turn prompt/runtime availability checks to `toolCatalog.hasTool(...)` and remove the now-unused provider runtime registry surface.
2. Remove the unused `hosted-or-remote` host kind and simplify capability normalization/binding helpers to trust normalized definitions.
3. Throw on duplicate capability names and duplicate bound tool names instead of silently shadowing.
4. Split the default-catalog option that currently conflates canonical writes with outward side effects, and update inbox routing prompt wording from "CLI tool calls" to "tool calls."
5. Add focused tests for bound-catalog gating, duplicate guards, and the renamed profile option, then run the required verification.
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
