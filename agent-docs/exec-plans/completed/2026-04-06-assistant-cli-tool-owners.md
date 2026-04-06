## Goal (incl. success criteria):
- Split `packages/assistant-core/src/assistant-cli-tools.ts` into separate owner modules for capability definitions, execution adapters, policy wrappers, and catalog profiles.
- Add explicit provenance metadata for every assistant capability so catalogs and audits can distinguish descriptor-generated tools, helper tools, CLI-backed tools, native-local-only tools, and similar origins.
- Preserve current catalog behavior and keep the refactor scoped to the assistant tool runtime surface.

## Constraints/Assumptions:
- Preserve unrelated dirty worktree edits.
- Do not expose secrets or personal identifiers.
- Prefer moving existing behavior behind clearer ownership boundaries over changing tool semantics.
- Keep assistant tool catalog consumers compatible unless a narrow schema/type update is required for provenance.

## Key decisions:
- Land the split under `packages/assistant-core/src/assistant-cli-tools/` and keep `assistant-cli-tools.ts` as the public facade.
- Treat provenance as first-class tool metadata that flows through the catalog/spec surface instead of as comments or file naming only.
- Keep command blocking, auto-format/default injection, and similar policy behavior out of the execution adapter layer so it can be audited independently.

## State:
- completed

## Done:
- Read the repo routing, completion, verification, and testing docs required for repo code work.
- Confirmed `assistant-cli-tools.ts` currently mixes catalog composition, CLI execution, command-blocking policy, web/helper tools, and capability definitions in one 2488-line module.
- Confirmed `AssistantToolDefinition` / `AssistantToolSpec` currently do not carry provenance metadata.
- Split the assistant tool runtime into a thin public facade plus owner modules for capability definitions, execution adapters, policy wrappers, and catalog profiles under `packages/assistant-core/src/assistant-cli-tools/`.
- Added explicit tool provenance metadata to the tool definition/spec surface and rendered it in inbox routing tool catalogs.
- Added focused provenance assertions in assistant harness and inbox model harness tests.
- Verified the touched surface with `pnpm --dir packages/assistant-core typecheck`, `pnpm --dir packages/assistant-core build`, `pnpm --dir packages/assistant-core test`, focused CLI assistant-tool tests without coverage, and the same focused CLI assistant-tool tests with coverage.

## Now:
- Close the plan with the scoped commit helper.

## Next:
- None.

## Open questions (UNCONFIRMED if needed):
- Scoped verification note: root `pnpm typecheck` remains red for an unrelated `apps/cloudflare` failure importing `@murphai/assistant-runtime/hosted-assistant-env`, and `pnpm --dir packages/cli test` still includes one unrelated failing expectation in `packages/cli/test/assistant-service.test.ts` around private assistant-memory-file access in shared auto-reply turns.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-06-assistant-cli-tool-owners.md`
- `packages/assistant-core/src/assistant-cli-tools.ts`
- `packages/assistant-core/src/model-harness.ts`
- `packages/assistant-core/src/inbox-model-contracts.ts`
- `packages/assistant-core/src/inbox-model-harness.ts`
- `packages/cli/test/inbox-model-harness.test.ts`
- `packages/cli/test/assistant-cli.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
