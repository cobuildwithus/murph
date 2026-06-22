Goal (incl. success criteria):
- Address ReviewGPT round 2 findings on PR 249 without broadening the integration ingest journal migration.
- Success means migration never deletes verified legacy integration raw artifacts while leaving nested event references behind, and hosted restore can replay migration raw deletions from canonical receipts.

Constraints/Assumptions:
- Keep the migration conservative: top-level event `rawRefs` can be translated to ingest outputs and removed; nested event references that point at legacy integration raw paths should block before staging writes because there is no v2 replacement path.
- Use one shared event raw-reference collector for migration preflight and vault validation.
- Preserve existing append-only and immutable-raw write invariants; replay authorization must come from the original persisted receipt action.

Key decisions:
- Add a shared internal `collectEventRawReferences` helper and use it from both migration planning and vault validation.
- Keep migration translation limited to top-level `rawRefs`; nested legacy integration references in `evidence`, `attachments`, event `media`, or `workout.media` block before any staged write.
- Preserve `allowRaw` when assistant-runtime parses hosted canonical delete receipt actions for restore replay.

State:
- ReviewGPT round 2 fixes are implemented and verified locally.

Done:
- Confirmed migration rewrites only top-level `EventRecord.rawRefs`.
- Confirmed vault validation has a separate partial collector for top-level rawRefs, attachments, event media, and workout media, but not evidence raw refs.
- Confirmed assistant-runtime hosted restore reconstructs delete receipt actions without `allowRaw`.
- Added `packages/core/src/event-raw-references.ts` as the shared event raw-reference collector.
- Patched migration preflight to block nested legacy integration raw references before writes while preserving the existing top-level rawRef output mapping behavior.
- Patched vault validation to use the shared collector, including `evidence[].rawRef`.
- Patched hosted workspace restore receipt parsing to retain `allowRaw` on delete actions.
- Added migration regressions for nested legacy references in evidence, attachments, event media, and workout media.
- Added vault validation coverage for evidence raw refs to legacy integration storage.
- Extended hosted restore coverage so an integration-storage migration receipt replays an event rewrite and raw deletion.
- Verification passed:
  - `pnpm --filter @murphai/core exec vitest run --config vitest.config.ts --no-coverage test/integration-ingest-migration.test.ts`
  - `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts --testNamePattern "restores base snapshots and authoritative latest hot state before mailbox import"`
  - `pnpm --filter @murphai/core typecheck`
  - `pnpm --filter @murphai/assistant-runtime typecheck`
  - `pnpm --filter @murphai/core test:coverage`
  - `pnpm --filter @murphai/assistant-runtime test` passed on rerun; first run hit two unrelated timing timeouts in `hosted-runtime-workspace-runner.test.ts`, and both failed tests passed when rerun directly.
  - `pnpm test:diff`

Now:
- Commit and push the ReviewGPT round 2 fix pass.

Next:
- Rerun ReviewGPT against PR 249 after the fix commit is pushed.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/core/src/integration-ingest-migration.ts`
- `packages/core/src/vault.ts`
- `packages/core/src/event-raw-references.ts`
- `packages/core/test/integration-ingest-migration.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `audit-packages/pr-249-round-2.md` (review artifact; not intended for commit)
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
