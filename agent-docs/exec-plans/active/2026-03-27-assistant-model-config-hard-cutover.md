# Assistant Model Config Hard Cutover

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

- Refactor assistant model/provider configuration to be provider-scoped end to end.
- Treat this as a hard cutover: new config and session state should use the provider-scoped shape directly instead of preserving legacy flat-field compatibility helpers.

## Success criteria

- Operator config stores assistant defaults by provider and the active provider reads only its scoped defaults.
- Provider config handling sanitizes unsupported fields per provider family, including OpenAI-compatible `headers`.
- Assistant session persistence stores provider-specific state in `providerState` and no longer depends on legacy flat prompt-version fields.
- Provider execution, catalog, and discovery all flow through one shared provider registry.
- Failover hashing ignores stale unsupported fields so route identity only reflects effective provider config.
- Setup flow authenticates before OpenAI-compatible model discovery and does not invent a fake fallback model.
- `/model` UI and related runtime flows use catalog snapshots and persist provider-scoped defaults.
- CLI overrides thread `headersJson` through assistant ask/chat paths.
- Focused tests cover the cutover behavior.

## Scope

- In scope:
- `packages/cli` assistant/provider/config/runtime/setup/model UI files and their focused tests
- generated CLI metadata updates required by the changed command options
- narrow persistence/schema updates needed for the new provider-scoped state
- Out of scope:
- preserving legacy flat assistant default projection behavior
- broad non-assistant CLI cleanup
- unrelated dirty-tree fixes outside the touched assistant/model-config lane

## Constraints

- Preserve unrelated in-flight worktree edits.
- Keep the cutover explicit and behaviorally coherent rather than layering compatibility shims.
- Run required verification plus the mandatory `simplify`, `test-coverage-audit`, and `task-finish-review` subagent passes before handoff.

## Risks and mitigations

1. Risk: stale stored config or failover routes still influence runtime through unsupported fields.
   Mitigation: centralize provider sanitization and hash only the sanitized provider-specific config.
2. Risk: OpenAI-compatible setup/model selection still assumes fake fallback models.
   Mitigation: drive selection from static/discovered catalog entries only and keep empty-state handling explicit.
3. Risk: session recovery or persistence silently loses provider-specific state.
   Mitigation: add dedicated provider-state helpers and focused persistence/runtime tests.

## Verification plan

- Required repo commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused assistant/package checks as needed while iterating
- Direct scenario proof: exercise the model-catalog/provider-default path through focused tests and, if useful, a built CLI help/schema readout
