# Assistant state + cron binding

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

- Add a generic `vault-cli assistant state` JSON scratchpad surface under `assistant-state/` for small non-canonical runtime documents.
- Let assistant cron jobs opt into one bound state document via `stateDocId` instead of assuming every cron needs persisted scratch state.
- Expose the new state surface through the same supported assistant tool boundary used for assistant memory and cron so stateful cron prompts can read and update their own state without direct file edits.

## Success criteria

- `vault-cli assistant state show|put|patch|delete|list` exists with typed outputs and path-safe document ids.
- Assistant state docs live under `assistant-state/state/` and remain non-canonical runtime state only.
- Assistant cron jobs gain an optional `stateDocId` binding plus CLI flags for opting into a default doc or specifying an explicit one.
- Cron runs only receive state guidance when a job has `stateDocId`; stateless crons behave exactly as before.
- Provider-backed assistant sessions can use the new state surface through the existing bounded assistant tool exposure path.

## Scope

- In scope:
  - runtime-state path additions for assistant state docs
  - typed assistant state CRUD/list service + CLI wiring
  - optional cron `stateDocId` binding and prompt/tool guidance
  - targeted tests and docs for the new operator/runtime surface
- Out of scope:
  - new canonical vault records
  - freeform direct editing of `assistant-state/` files
  - opinionated cron-specific state semantics beyond the optional binding

## Constraints

- Keep the new surface generic; do not start with a cron-only storage API.
- Keep assistant state outside the canonical vault and separate from assistant memory/journal semantics.
- Preserve current cron scheduling, run-history, and delivery behavior for stateless jobs.
- Keep the command surface small and composable so future assistant flows can reuse it.

## Risks and mitigations

1. Risk: the surface becomes too cron-shaped and hard to reuse elsewhere.
   Mitigation: make `assistant state` generic first and model cron support as an optional binding only.
2. Risk: arbitrary file access sneaks back in through prompt guidance.
   Mitigation: expose only typed `assistant state` commands/tools and explicitly forbid direct `assistant-state/` edits in assistant guidance.
3. Risk: direct overlap with active assistant contract/provider-config work causes regressions.
   Mitigation: read the live file state first, keep edits narrow, and avoid reshaping unrelated provider/session semantics.

## Tasks

1. Add a shared assistant-state document path contract and narrow storage helpers with write serialization.
2. Add typed `assistant state` command contracts and CLI handlers for show/put/patch/delete/list.
3. Extend cron jobs with optional `stateDocId` binding and thread that binding through add/show/list/preset flows.
4. Inject state-aware cron guidance and tool exposure only when a bound `stateDocId` exists.
5. Add focused tests, update docs, run required checks, and complete the mandated audit passes.

## Verification

- Focused commands:
  - `pnpm exec vitest run packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-cli.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/incur-smoke.test.ts --no-coverage --maxWorkers 1`
- Required commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
