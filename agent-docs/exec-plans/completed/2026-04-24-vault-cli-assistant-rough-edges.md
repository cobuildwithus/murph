## Goal

Fix the assistant-facing vault CLI rough edges surfaced by the dummy-vault stress test report, with success defined as:

- high-impact invalid input paths fail before writing runtime residue;
- common machine-readable command failures use stable, actionable error codes;
- write commands reject empty or structurally unsafe payloads where the report found silent acceptance;
- assistant/operator docs describe current safe CLI usage and remaining intentional semantics.

## Scope

- `packages/cli` command entrypoints, error bridging, and focused CLI tests.
- `packages/assistant-cli` command validation and focused assistant CLI tests.
- `packages/assistant-engine` knowledge command validation only if needed.
- Assistant-facing docs/instructions: `docs/contracts/03-command-surface.md` and `packages/openclaw-plugin/skills/murph/SKILL.md`.

## Out of Scope

- Core storage and query runtime redesigns already owned by active rows.
- Hosted web, Cloudflare, device-sync, health-commons, and inboxd storage lanes.
- Broad compatibility changes that would require changing persisted data format.

## Risks

- Several report items touch active high-risk rows. Keep fixes additive and stop before overlapping storage/runtime rewrites.
- Some schema/help behavior may be owned by the CLI framework rather than this repo package; document and add guardrails if changing it directly would be too wide.

## State

- Current status: completed.
- Active row removed from `COORDINATION_LEDGER.md`; plan archived under completed plans.

## Done

- Stress-test findings reduced to a focused CLI/operator rough-edge slice.
- Added JSON schema indexes for root/group schema discovery.
- Added focused typed errors for missing retryability metadata, Mapbox token setup, missing memory records, invalid vault roots on selected read-only commands, blank knowledge bodies, and unsafe assistant delivery targets.
- Updated assistant/operator command-surface docs.
- Focused regression tests passed for CLI schema/error handling, memory, Mapbox route setup, CLI entrypoint aliasing, and assistant deliver/status behavior.
- Required `coverage-write` audit added invalid-vault and missing-session coverage.
- Required `task-finish-review` found and verified fixes for explicit `--vault` handling, CLI typecheck gaps, knowledge H1 title fallback, and assistant status/session vault preflight.
- `pnpm --dir packages/cli typecheck`, `pnpm --dir packages/assistant-cli typecheck`, focused CLI/assistant/knowledge tests, and `git diff --check` passed.

## Now

- Handoff.

## Next

- None for this task.
Status: completed
Updated: 2026-04-24
Completed: 2026-04-24
