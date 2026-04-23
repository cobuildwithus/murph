# Restore core raw-manifest retry idempotency and history event id uniqueness

Status: active
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Restore idempotent attachment-backed event retries and make health-history appends fail closed on explicit `eventId` reuse instead of silently creating competing revision-1 records.

## Success criteria

- Attachment-backed event writes can stage a new immutable raw manifest for the same owner/month directory on later retries or revisions without colliding on a shared `manifest.json`.
- Vault validation and raw-reference checks still prove that every referenced raw artifact directory has at least one valid raw-import manifest and continue to validate existing inbox/sync exceptions correctly.
- `appendHistoryEvent` rejects caller-supplied `eventId` values that already exist in stored history entries, while generated ids continue to append successfully.
- Focused `packages/core` tests cover the raw-manifest retry path, vault validation with import-keyed manifests, and duplicate history-id rejection.
- Required scoped verification, completion audits, and the scoped commit complete, or any unrelated blocker is documented precisely.

## Scope

- In scope:
- `packages/core/src/{domains/events.ts,event-attachments.ts,raw.ts,operations/raw-manifests.ts,history/api.ts,vault.ts}`
- directly coupled `packages/core/test/{operations-thresholds,event-attachments,workout-primitives,core,core-event-thresholds,health-history-family}.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-core-raw-manifest-and-history-idempotency.md,COORDINATION_LEDGER.md}`
- Out of scope:
- broader event lifecycle/update API redesign beyond duplicate-id rejection for history appends
- raw sync-import manifest behavior or inbox attachment recovery-manifest behavior
- unrelated `packages/core` lock/write-batch work already claimed by the active core lock-order row

## Constraints

- Technical constraints:
- Preserve current raw owner directory layout keyed by owner/year/month/id; only the manifest file naming/lookup rules should change for this task.
- Keep raw manifests immutable and create-only; do not introduce in-place manifest merging for shared directories in this change.
- Preserve contract validation, owner/raw-directory checks, and artifact-directory validation for existing manifests.
- Treat explicit history `eventId` reuse as invalid input rather than inventing implicit revision-bump semantics.
- Product/process constraints:
- This is storage/reliability work in `packages/core`, so keep the diff narrow, add regression coverage before trusting retries, and capture direct proof in addition to scripted verification.
- Work safely in the current dirty tree and avoid touching overlapping active rows outside the exact files above.

## Risks and mitigations

1. Risk: Import-keyed manifest paths could break vault validation or raw-reference checks that currently hardcode `manifest.json`.
   Mitigation: Update the shared manifest-path helpers and vault validators together, and add coverage proving both new immutable manifest names and legacy directory scans remain valid.
2. Risk: Event retry semantics could still fail if the new manifest identity is not stable enough across same-import rewrites.
   Mitigation: Key the manifest path from normalized import identity plus owner directory, and add a regression test that retries the same attachment-backed event with a changed `importedAt`.
3. Risk: History duplicate rejection could accidentally block generated ids or legitimate manual revision fixtures in tests.
   Mitigation: Only reject when the caller explicitly supplied `eventId` and an existing stored history entry already uses it; keep read/list revision collapse behavior unchanged for stored legacy/manual revision records.

## Tasks

1. Register the task in the coordination ledger and keep the execution plan updated as the implementation shape firms up.
2. Change raw-manifest staging to write immutable import-keyed manifest filenames inside the existing raw owner directory and thread that path through attachment-backed event writes.
3. Update raw manifest lookup/validation helpers so referenced artifact directories require at least one valid manifest rather than a hardcoded shared `manifest.json`.
4. Make `appendHistoryEvent` create-only for explicit caller-supplied ids by checking existing stored history entries before append.
5. Add focused `packages/core` regression tests for attachment retry idempotency, manifest validation, and duplicate history-id rejection.
6. Run scoped verification, required completion audits, re-run affected checks after fixes, and finish with a scoped commit.

## Decisions

- Keep the existing owner/month raw directory layout and solve retry collisions by making manifests immutable per import identity instead of adding merge/update semantics to a shared manifest file.
- Preserve backward-compatible manifest discovery by validating manifests at the directory level rather than requiring one fixed filename.
- Reject duplicate explicit history ids up front rather than adding a new history update API in this task.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/core/src/domains/events.ts packages/core/src/event-attachments.ts packages/core/src/raw.ts packages/core/src/operations/raw-manifests.ts packages/core/src/history/api.ts packages/core/src/vault.ts packages/core/test/operations-thresholds.test.ts packages/core/test/event-attachments.test.ts packages/core/test/workout-primitives.test.ts packages/core/test/core.test.ts packages/core/test/core-event-thresholds.test.ts packages/core/test/health-history-family.test.ts`
- `pnpm test:smoke`
- direct proof: run focused `packages/core` tests that exercise attachment retry idempotency and duplicate history-id rejection
- Expected outcomes:
- `packages/core` typed/scoped verification passes without widening into unrelated package failures.
- Raw attachment retries can append a later event revision while writing a new manifest file in the same owner directory.
- Explicit duplicate history ids fail with a deterministic validation error before any append is staged.
