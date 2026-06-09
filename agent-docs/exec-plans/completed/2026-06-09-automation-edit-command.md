# Automation Edit Command

## Goal

Add a typed sparse `vault-cli automation edit <lookup>` command so an operator can update one existing automation field, such as `--continuityPolicy preserve`, without resubmitting instructions, schedule, or route fields.

## Constraints

- Keep `automation save` create/full-replacement shaped.
- Core should own latest-record merge under the automation registry lock.
- Omitted fields preserve existing automation values.
- Route inference/current-route lookup must not happen unless route flags are explicitly supplied.
- Preserve existing unrelated working-tree edits.

## Working Set

- `packages/core/src/automation.ts`
- `packages/core/test/markdown-documents.test.ts`
- `packages/cli/src/commands/automation.ts`
- `packages/cli/config.schema.json`
- `packages/cli/src/incur.generated.ts`
- `packages/cli/test/automation.test.ts`
- `packages/cli/test/incur-smoke.test.ts`
- `packages/cli/test/cli-typed-agent-inputs-schema.test.ts`

## Verification Plan

- Focused CLI automation tests.
- `pnpm typecheck`
- Truthful scoped coverage through `pnpm test:diff` for touched files or package-local CLI coverage if needed.

## Status

- Implemented `patchAutomation` in core and typed `automation edit` in the CLI.
- Regenerated CLI config schema and typed command artifacts.
- Verified focused CLI/core behavior, workspace typecheck, core coverage, smoke tests, and diff-scoped verification up to unrelated active `apps/cloudflare` hosted prewarm/typing errors.
- CLI package coverage is blocked by an unrelated untracked current-route continuity test from a separate active lane.
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
