# CLI binding-layer refactor plan

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

Goal (incl. success criteria):
- Make the targeted CLI command modules act as pure binding layers: schema, option normalization, one service/usecase call, and response mapping only.
- Success means `document`, `provider`, `event`, `experiment`, `journal`, and `vault` commands no longer own runtime loading or filesystem/canonical-write orchestration, while current command behavior remains covered by existing CLI tests.

Constraints/Assumptions:
- Preserve adjacent edits from the active CLI expansion lanes; do not revert or rewrite unrelated work.
- Keep the refactor inside the existing CLI service boundary and avoid broadening into unrelated inbox, export, cursor, or package-runtime work.
- The current repo state is dirty; only touch files required for the binding-layer extraction and work carefully on top of uncommitted edits.

Key decisions:
- Add new service methods to `VaultCliServices` rather than letting command files import helper modules directly.
- Move the heavy orchestration from `packages/cli/src/commands/*helpers.ts` into `packages/cli/src/usecases/*` modules so command files become thin bindings.
- Reuse existing result shapes and validation logic where possible to keep the refactor behavior-preserving.

State:
- completed

Done:
- Re-read the repo routing, architecture, reliability/security, verification, and completion-workflow docs.
- Confirmed the current command files still own runtime loading, JSON file reading, and canonical write orchestration in the targeted slices.
- Extended the CLI service boundary so the targeted command modules delegate through `services`.
- Moved the provider/event and experiment/journal/vault helper implementations into `packages/cli/src/usecases/*` and left compatibility re-export shims under `packages/cli/src/commands/*helpers.ts`.
- Verified the affected runtime paths with focused Vitest execution through `packages/cli/test/runtime.test.ts`.

Now:
- None.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/completed/2026-03-13-cli-binding-layer.md`
- `packages/cli/src/commands/document.ts`
- `packages/cli/src/commands/provider.ts`
- `packages/cli/src/commands/event.ts`
- `packages/cli/src/commands/experiment.ts`
- `packages/cli/src/commands/journal.ts`
- `packages/cli/src/commands/vault.ts`
- `packages/cli/src/commands/samples.ts`
- `packages/cli/src/commands/provider-event-read-helpers.ts`
- `packages/cli/src/commands/experiment-journal-vault-read-helpers.ts`
- `packages/cli/src/usecases/types.ts`
- `packages/cli/src/usecases/integrated-services.ts`
- `packages/cli/src/usecases/shared.ts`
- `packages/cli/src/usecases/document.ts`
- `packages/cli/src/usecases/provider-event.ts`
- `packages/cli/src/usecases/experiment-journal-vault.ts`
- `packages/cli/test/runtime.test.ts`
- `packages/cli/test/cli-expansion-provider-event-samples.test.ts`
- `packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts`
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
