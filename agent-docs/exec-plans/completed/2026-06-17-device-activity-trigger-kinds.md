# Broaden Device Activity Trigger Kinds

## Goal

Allow the existing `deviceActivity` automation trigger to target more than WHOOP walks, including arbitrary normalized workout/activity kinds and WHOOP sleep sessions.

Success criteria:

- Automation frontmatter no longer restricts `schedule.activityKind` to only `walk`.
- CLI `automation save --trigger deviceActivity --activity-kind ...` accepts normalized values such as `sleep`, `running`, `cycling`, and `strength-training`.
- Assistant runtime matching includes imported activity sessions and sleep sessions while preserving source filtering.
- Focused contracts, CLI, and assistant-engine tests cover non-walk activity and sleep matching.

## Scope

- In: automation contract schema, CLI option handling/generated metadata, assistant-engine device activity matching, focused tests.
- Out: new webhook/event ingestion, new automation trigger family, sync-window scheduling behavior.

## Constraints

- Keep the change on the existing `deviceActivity` primitive.
- Preserve existing `walk` behavior and WHOOP/whoop_v2 source filters.
- Do not add provider-specific state or speculative activity catalogs.
- Do not expose local identifiers, secrets, or private user data in files, logs, docs, or commits.

## Working Set

- `packages/contracts/src/automation.ts`
- `packages/contracts/test/automation-memory-event-lifecycle.test.ts`
- `packages/contracts/generated/frontmatter-automation.schema.json`
- `packages/cli/src/commands/automation.ts`
- `packages/cli/test/automation.test.ts`
- `packages/cli/src/incur.generated.ts`
- `packages/cli/config.schema.json`
- `packages/assistant-engine/src/assistant/device-activity-automations.ts`
- `packages/assistant-engine/test/device-activity-automations.test.ts`

## Verification Plan

- Regenerate contract and CLI schema artifacts.
- Run focused contracts, CLI, and assistant-engine tests for the changed paths.
- Run required typecheck.
- Run completion review passes required for this scoped code/config change.
- Commit through `scripts/finish-task`.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
