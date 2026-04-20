## Title

Land the supplied hosted-run review fixes without widening into broader hosted wake cleanup.

## Goal

Apply the uploaded patch so hosted-run commit fails closed on incomplete ingress event results, the last production `assistantNextWakeAt` residue is removed, and the related docs describe the current run-centric `nextRuntimeWakeAt` protocol.

## Scope

- `apps/web/src/lib/hosted-run/store.ts`
- `packages/assistant-runtime/src/hosted-runtime/execution.ts`
- `scripts/check-hosted-run-stale-residue.ts`
- `scripts/check-hosted-run-stale-residue.test.ts`
- narrow docs/readme/env comments updated by the supplied patch only

## Constraints

- Treat the uploaded patch as the behavioral source of truth and keep the landing narrow.
- Preserve unrelated dirty-tree edits and coordinate carefully with overlapping hosted-run and assistant-runtime lanes already registered in the ledger.
- Do not broaden into schema migrations or mass terminology cleanup for compatibility-facing `wake*` fields.
- Redacted hosted-run recovery state and `nextRuntimeWakeAt` remain the intended seams.

## Verification

- planned: `git diff --check`
- planned: `pnpm typecheck`
- planned: `pnpm test:diff apps/web/src/lib/hosted-run/store.ts packages/assistant-runtime/src/hosted-runtime/execution.ts scripts/check-hosted-run-stale-residue.ts scripts/check-hosted-run-stale-residue.test.ts`

## Notes

- `apps/web/src/lib/hosted-run/store.ts` overlaps an active hosted-run security lane but is currently clean; keep this change limited to event-result validation and fail-closed commit behavior.
- `packages/assistant-runtime/src/hosted-runtime/execution.ts` overlaps an active run-drain lane but is currently clean; keep this change limited to stale-residue naming cleanup that matches the run-centric protocol.
