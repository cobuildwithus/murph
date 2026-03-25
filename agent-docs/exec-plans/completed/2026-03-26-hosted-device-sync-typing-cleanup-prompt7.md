# Prompt 7: Hosted Device-Sync Typing Cleanup

## Goal

Make the hosted device-sync Prisma store/control-plane typing explicit so mapper and transaction shapes are compiler-checked, while preserving all current runtime behavior, route responses, and database writes.

## Scope

- `apps/web/src/lib/device-sync/prisma-store.ts`
- `apps/web/src/lib/device-sync/control-plane.ts`
- Focused `apps/web` tests that cover the affected store/control-plane behavior

## Constraints

- No public API or store return-shape changes
- No behavior changes to heartbeat writes or token refresh handling
- Keep the fix explicit and readable: prefer named Prisma payload aliases over indirect generic tricks
- Do not touch unrelated parent-workspace edits; work only in this isolated copy
- Do not commit from this worker run

## Planned Work

1. Inspect the current Prisma store/control-plane types, Prisma include/select shapes, and heartbeat error patch callers.
2. Introduce named Prisma payload aliases and transaction-client types for the hosted device-sync store.
3. Replace `ReturnType<typeof requireHostedConnectionBundleRecord>` with an exported bundle alias and thread it through control-plane helpers.
4. Make heartbeat error intent explicit with an internal discriminated union, adapting it back to the current public input shape if external callers rely on it.
5. Run targeted verification for the affected `apps/web` tests and relevant typechecking.

## Verification

- `pnpm typecheck`
- Focused `apps/web` tests covering the touched store/control-plane flows

## Notes

- This is a behavior-preserving refactor. If a type cleanup appears to require a runtime change, stop and re-evaluate before widening scope.
