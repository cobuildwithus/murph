# Assistant cron scheduling

Status: completed
Created: 2026-03-23
Updated: 2026-03-23

## Goal

- Add a vault-scoped assistant cron system that can schedule one-shot, interval, and cron-expression jobs under `assistant-state/`.
- Expose that scheduling surface as both operator CLI commands and a native assistant tool so assistant automation can create and inspect jobs itself.
- Execute due jobs while `vault-cli assistant run` is active without breaking existing assistant automation or memory behavior.

## Success criteria

- `vault-cli assistant cron` supports add/status/list/show/enable/disable/run/runs with typed outputs.
- Assistant cron state lives outside the canonical vault under `assistant-state/cron/`.
- The assistant runtime exposes the cron subtree as a provider/MCP tool alongside the existing assistant tool surface.
- `assistant run` processes due cron jobs for the selected vault and records run history deterministically.
- Focused tests cover schedule parsing, command routing, state persistence, and runtime integration.

## Scope

- In scope:
  - assistant cron state/storage and locking
  - cron schedule parsing and due-job execution
  - CLI command wiring and typed command contracts
  - assistant tool exposure through the provider-turn config path
  - focused tests and any required runtime-state exports
- Out of scope:
  - background execution outside `assistant run`
  - canonical vault writes outside the existing assistant service flow
  - new web UI for cron management

## Constraints

- Keep cron state outside the canonical vault.
- Preserve current assistant automation, memory, and provider-turn semantics.
- Port the provided patch behavior manually where the current tree has drift instead of forcing stale hunks.
- Keep command topology truthful for incur-generated artifacts.

## Risks and mitigations

1. Risk: cron command wiring drifts from the current incur tree.
   Mitigation: inspect the current assistant command/router structure first and refresh generated CLI artifacts after implementation.
2. Risk: scheduled runs interfere with existing assistant automation loops or concurrent state writes.
   Mitigation: isolate cron state/locking, preserve current automation scan limits, and add focused runtime tests.
3. Risk: agent-facing tool exposure widens assistant authority unintentionally.
   Mitigation: route the cron subtree through the same bounded assistant CLI/tool config path used for existing assistant tooling.

## Tasks

1. Inspect the current assistant command/runtime layout and map the provided patch onto the drifted files.
2. Implement assistant cron state, schedule parsing, locking, and run-history handling.
3. Wire the cron subtree into the CLI, generated topology, and assistant provider tool exposure.
4. Process due cron jobs from `assistant run` and preserve current automation behavior.
5. Add focused tests, run required audits/checks, and record outcomes.

## Verification

- Focused commands:
  - `pnpm exec vitest run packages/cli/test/assistant-cron.test.ts packages/cli/test/assistant-cli.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/incur-smoke.test.ts --no-coverage --maxWorkers 1`
- Required commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Outcome

- Added vault-scoped assistant cron state under `assistant-state/cron/` with stored job definitions, run history, schedule parsing, and write locking.
- Added `vault-cli assistant cron status|list|show|add|remove|enable|disable|run|runs` plus matching result contracts, smoke coverage, and focused tests.
- Exposed the cron subtree to provider-backed assistant turns through the same bounded CLI/MCP path used for assistant memory.
- Processed due assistant cron jobs during `vault-cli assistant run` so scheduled prompts execute while the assistant automation loop is active.

## Verification results

- Passed:
  - `pnpm build`
  - `pnpm test:smoke`
  - `pnpm exec vitest run packages/cli/test/assistant-cron.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-state.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/cli/test/assistant-cli.test.ts packages/cli/test/incur-smoke.test.ts --no-coverage --maxWorkers 1 -t "assistant cron"`
- Required commands failed for unrelated pre-existing issues outside this cron change:
  - `pnpm typecheck`
    - fails while `packages/importers` builds `packages/core`; `packages/core/src/shared.ts` reports missing `packages/contracts/dist/index.d.ts`
  - `pnpm test`
    - fails during `pnpm build` in the unrelated inbox/email lane: `packages/cli/src/inbox-services.ts` and `packages/cli/src/inbox-services/connectors.ts`
  - `pnpm test:coverage`
    - fails at the same unrelated inbox/email build errors as `pnpm test`
