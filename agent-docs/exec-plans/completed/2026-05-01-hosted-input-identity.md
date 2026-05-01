# Hosted Input Identity

## Goal

Make hosted `AssistantInputEvent` identity depend on provider/mailbox dedupe identity instead of mailbox row/order identity, so duplicate mailbox rows with the same event identity cannot create distinct assistant input IDs.

Success criteria:

- Hosted mailbox input IDs are derived from `sourceRef.kind`, `sourceRef.lane`, and `sourceRef.dedupeKey ?? sourceRef.eventId`.
- `itemId`, `laneSeq`, payload source, and payload schema remain stored as ordering/audit metadata rather than ID inputs.
- Regression coverage proves same dedupe/event identity with different `itemId` or `laneSeq` upserts one assistant input event.

## Constraints

- Preserve unrelated dirty checkout edits and existing active hosted/assistant-runtime rows.
- Do not log or fixture real provider payloads, mailbox details, secrets, local paths, or direct personal identifiers.
- Do not weaken assistant input ordering/cursor behavior.

## Scope

- Expected production owner: `packages/assistant-engine/src/assistant/input-store.ts`.
- Expected tests: `packages/assistant-engine/test/assistant-input-store.test.ts`.
- Update docs only if the code behavior introduces a new durable contract not already covered by hosted runtime protocol docs.

## Verification

- Focused assistant-engine input-store tests.
- `pnpm typecheck`.
- Scoped `test:diff` or package coverage lane as required by workflow.
- Required security/privacy, coverage-write, and task-finish review passes before handoff.

## State

- 2026-05-01: Plan opened. Implementation not started.
- 2026-05-01: Store now derives hosted input IDs from lane plus `dedupeKey ?? eventId`, keeps row/order metadata in `sourceRef` and `cursor.sourcePosition`, accepts legacy stored IDs for existing checkpoints, and scans existing records by dedupe/event identity before writing a new record. Focused assistant-engine tests and package typecheck passed.
- 2026-05-01: Security/privacy review passed with no findings; added legacy-record upgrade coverage from its residual-risk note. Coverage-write pass added lane-distinct identity coverage. Focused assistant-engine tests, package typecheck, diff-check, and full assistant-engine no-coverage tests passed. Root typecheck, diff-aware reverse-dependent verification, and package coverage remain blocked by unrelated active rows in this dirty checkout.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
