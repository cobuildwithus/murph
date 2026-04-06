# Gateway-Local Source Event Simplification

## Goal

Simplify the gateway-local persisted input model so the local projection store derives snapshots from one source-event table plus attachments instead of continuing to grow bespoke source-side tables per input shape.

## Success Criteria

- `packages/gateway-local` persists gateway source inputs in a unified `gateway_source_events` table plus `gateway_capture_attachments`.
- Snapshot derivation, event-log rebuilding, and reply-target lookup still behave correctly on top of the unified source-event model.
- Existing gateway-local integration coverage still passes and covers the rebuildable-source invariants.
- Durable package docs reflect the simplified gateway-local source model if the package boundary description changes materially.

## Constraints

- Preserve the rebuildable projection-store architecture and keep canonical writes outside gateway-local.
- Do not overwrite unrelated dirty-tree edits elsewhere in the repo.
- Keep the refactor proportional: simplify source persistence without widening runtime behavior or adding speculative message-kind abstractions beyond the unified event seam.

## Planned Steps

1. Inspect the current gateway-local store/schema/snapshot path and identify all direct dependencies on the bespoke source tables.
2. Refactor the store to use a unified source-event table plus attachments, updating snapshot derivation and focused tests.
3. Run required verification for the touched packages, do a final local review, and commit the scoped change.

## Verification

- `pnpm typecheck` (failed for unrelated existing `apps/web` branch work: `apps/web` typecheck errors in `scripts/local-reset-hosted-onboarding.ts`, `src/lib/hosted-onboarding/invite-service.ts`, and `test/hosted-onboarding-member-store.test.ts`)
- `pnpm --dir packages/gateway-local typecheck` (passed)
- `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/gateway-local-service.test.ts --no-coverage` (passed, 16 tests)

Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
Completed: 2026-04-07
