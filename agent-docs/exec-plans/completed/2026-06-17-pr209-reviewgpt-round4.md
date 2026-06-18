Goal (incl. success criteria):
- Land accepted ReviewGPT round 4 fix for PR 209 clinical import CLI surfaces.
- Success means assertion, vitals, diagnostic-test, and clinical-note import-json payloads require stable `externalRef`, reject explicit `eventId`, route through externalRef-reconciled event batch import, and retry without duplicating facts.

Constraints/Assumptions:
- Keep ReviewGPT response artifacts in `audit-packages/` uncommitted.
- Preserve manual `save` commands without requiring `externalRef`.
- Use the existing core event batch reconciliation path instead of adding a new dedupe mechanism.

Key decisions:
- Accept the ReviewGPT round 4 finding as real: non-social file imports were not idempotent because they reused manual append/upsert paths.
- Add canonical `test` to the public batch-import event kind allowlist so diagnostic-test import-json can use the same idempotent path.

State:
- In progress.

Done:
- Ran ReviewGPT round 4 on the pushed PR head.
- Verified `appendHistoryEvent`/`upsertEvent` do not provide externalRef retry semantics for these file imports.
- Verified `importEventBatch` rejects explicit event ids and reconciles by externalRef.
- Split manual save schemas from stricter import-json schemas.
- Routed assertion, vitals, diagnostic-test, and clinical-note import-json through `importEventBatch`.
- Added `test` to the public event batch import kind path for diagnostic-test imports.
- Updated real-vault retry coverage and command docs.

Now:
- Run focused typechecks and tests, then regenerate CLI schemas.

Next:
- Regenerate CLI schemas, run focused verification, commit/push, and run ReviewGPT round 5.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/vault-usecases/src/usecases/clinical-imports.ts
- packages/vault-usecases/test/clinical-imports.test.ts
- packages/vault-usecases/test/clinical-imports-real.test.ts
- packages/cli/src/commands/clinical-imports.ts
- packages/cli/test/clinical-imports.test.ts
- packages/core/src/domains/events/drafts.ts
- docs/contracts/03-command-surface.md
- docs/incur-payload-schema-migration-guide.md
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
