## Goal (incl. success criteria):
- Introduce a first-class assistant capability registry in `assistant-core` so each capability is defined once with its name, schema, provenance, mutation semantics, risk class, and preferred execution mode.
- Add execution-host abstractions so the same capability definition can run through different adapters, starting with a CLI-backed host and a native-local host.
- Keep current Murph write safety intact by routing canonical data writes through existing validated Murph services and CLI surfaces instead of exposing raw file-edit primitives as first-class defaults.

## Constraints/Assumptions:
- Preserve unrelated dirty worktree edits, including the concurrent assistant bootstrap/prompt changes already in progress.
- Build on the current `assistant-cli-tools` split instead of collapsing the modules back together.
- Keep existing assistant tool names and externally visible behavior stable unless a change is required to support the new capability model.
- Hosted/remote execution should be modeled as an extension point, but this task only needs a concrete seam plus the CLI-backed and native-local hosts.

## Key decisions:
- Treat the capability registry as the source of truth and project existing tool catalogs from it, rather than making catalogs own the definitions.
- Separate definition metadata from execution host binding so CLI-backed and native-local variants remain different adapters over the same capability shape.
- Encode mutation semantics and risk class alongside provenance so audits and prompt/catalog generation can reason over one coherent metadata surface.
- Preserve validated Murph write surfaces: capability hosts may execute through CLI or native adapters, but canonical writes still go through vault services or existing command wrappers rather than raw arbitrary file editing.

## State:
- completed

## Done:
- Read the required repo routing and workflow docs for repo code work.
- Inspected the current `assistant-cli-tools` split, catalog assembly, provenance contract, and overlapping assistant bootstrap edits.
- Confirmed the current runtime still treats tool catalogs as the top-level abstraction, with provenance attached but no first-class capability registry or execution host layer yet.
- Added first-class capability metadata in the assistant tool spec surface: mutation semantics, risk class, preferred execution mode, and resolved execution mode.
- Introduced assistant capability registry and execution-host abstractions in `model-harness`, including CLI-backed, native-local, and future hosted/remote host classes.
- Migrated assistant-core capability definitions onto the definition-first capability model and kept catalog profiles as projections over registry-owned capability definitions.
- Added focused harness and inbox-model coverage for registry metadata and host selection.
- Ran assistant-core typecheck, build, package tests, and focused CLI assistant tests without coverage.

## Now:
- Scoped implementation and verification are complete.

## Next:
- Commit the scoped assistant-core capability-registry change and hand off any unrelated remaining repo failures separately.

## Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any existing provider-specific runtime outside assistant-core implicitly depends on `AssistantToolDefinition` shape in a way that should now consume capability metadata directly.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-06-assistant-capability-registry-hosts.md`
- `packages/assistant-core/src/assistant-cli-tools.ts`
- `packages/assistant-core/src/assistant-cli-tools/shared.ts`
- `packages/assistant-core/src/assistant-cli-tools/capability-definitions.ts`
- `packages/assistant-core/src/assistant-cli-tools/catalog-profiles.ts`
- `packages/assistant-core/src/assistant-cli-tools/execution-adapters.ts`
- `packages/assistant-core/src/model-harness.ts`
- `packages/assistant-core/src/inbox-model-contracts.ts`
- `packages/assistant-core/test/**`
- `pnpm --dir packages/assistant-core typecheck`
- `pnpm --dir packages/assistant-core test`
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
