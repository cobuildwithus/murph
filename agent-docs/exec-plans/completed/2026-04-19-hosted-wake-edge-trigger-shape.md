## Title

Remove the unused hosted `edge_triggered` wake surface now that parser follow-up is not a hosted wake.

## Goal

Keep the hosted wake contract aligned with the actual hosted runtime by deleting the dead `edge_triggered` behavior path instead of preserving an unused parser-drain seam.

## Scope

- `apps/web/src/lib/hosted-wake/{store,store-append}.ts`
- `apps/web/prisma/{schema.prisma,migrations/202604171900_hosted_wake_baseline/migration.sql}`
- `apps/web/test/hosted-wake-store.test.ts`
- `packages/hosted-execution/src/contracts.ts`
- focused hosted wake tests only if needed

## Constraints

- Do not add a new `parser.drain` hosted wake kind; parser follow-up currently remains inline to hosted conversation ingestion.
- Preserve adjacent hosted-wake cursor, fetch-proof, and event-identity work already in flight.
- Treat the hosted wake schema as greenfield and keep the baseline migration aligned instead of adding a follow-up migration.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-wake/store.ts apps/web/src/lib/hosted-wake/store-append.ts apps/web/prisma/schema.prisma apps/web/prisma/migrations/202604171900_hosted_wake_baseline/migration.sql apps/web/test/hosted-wake-store.test.ts packages/hosted-execution/src/contracts.ts`
- `pnpm test:smoke`

## Notes

- The current hosted runtime handles parser work during `conversation.message` ingestion and does not materialize a parser-specific hosted wake.
- This change should leave only `ordered` and `coalescing` wake behaviors in the canonical hosted wake contract.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
