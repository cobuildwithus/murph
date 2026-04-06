# Assistant capability selection refactor

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Remove the remaining overlapping execution-selection models in `assistant-core` so capability definitions are the single source of truth for host preference and backend lane metadata.
- Preserve current assistant tool names and behavior while making the runtime surface distinguish selected host kind from backend lane.

## Success criteria

- Capability metadata exposes both preferred host kind and backend lane without collapsing configured web reads, hosted API calls, and local service/file execution together.
- Catalog-bound tool specs report the selected host separately from the capability's preferred host.
- Direct `defineAssistantTool` / `createAssistantToolCatalog([...])` usage is reduced to an explicit compatibility shim rather than a competing first-class model.
- Focused assistant-core and CLI tests cover the new metadata and host-binding behavior.

## Scope

- In scope:
  - `packages/assistant-core/src/model-harness.ts`
  - `packages/assistant-core/src/inbox-model-contracts.ts`
  - `packages/assistant-core/src/assistant-cli-tools/capability-definitions.ts`
  - `packages/assistant-core/src/inbox-model-harness.ts`
  - assistant capability/runtime binding tests in `packages/assistant-core/test/**` and `packages/cli/test/**`
- Out of scope:
  - changing user-facing tool names
  - adding new hosted execution hosts beyond the current abstraction seam

## Constraints

- Technical constraints:
  - Preserve existing catalog host fallback behavior.
  - Avoid reintroducing provenance as the routing source of truth.
- Product/process constraints:
  - Preserve unrelated worktree edits.
  - Run the required repo verification commands for the touched `packages/assistant-core` / `packages/cli` surface.

## Risks and mitigations

1. Risk: internal tests and bundle metadata may still assume `executionMode` means both preferred and selected execution.
   Mitigation: update the contracts, harness summaries, and focused tests together in one refactor.
2. Risk: removing the direct-tool path too aggressively could break callers outside the capability registry path.
   Mitigation: keep a compatibility shim, but make the capability model and bound-tool runtime artifact the primary path.

## Tasks

1. Split host kind and backend lane in assistant tool/capability metadata.
2. Introduce an explicit bound-tool runtime artifact and route capability binding through it.
3. Demote the legacy direct-tool constructor/catalog path to a compatibility shim.
4. Update focused tests and introspection output.
5. Run required verification.

## Decisions

- Use a coarse host-kind axis for binding (`cli-backed`, `native-local`, `hosted-or-remote`) and a separate backend-lane axis for operation provenance/runtime class.
- Keep provenance for audit/description fields, not as the sole execution-selection model.
- Hard-cut the legacy direct-tool constructor/catalog path instead of preserving a compatibility shim, because this surface is still greenfield inside the repo.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:packages`
- Expected outcomes:
  - Both commands pass for the current branch state, or any unrelated pre-existing failure is identified and scoped.
- Results:
  - `pnpm typecheck`: passed
  - `pnpm test:packages`: passed
Completed: 2026-04-06
