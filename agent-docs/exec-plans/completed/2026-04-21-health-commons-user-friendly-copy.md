## Goal

Land the supplied Health Commons copy patch so the protocol/library surfaces read like user-facing product copy across the touched experiment families and generated catalog outputs.

## Scope

- `packages/health-commons/content/**` only where the supplied copy patch changes protocol, family, biomarker, source, redirect, or change-log wording
- `packages/health-commons/generated/**` only for directly regenerated catalog artifacts that match the landed content copy
- directly coupled hosted-web consumer tests under `apps/web/test/**` only if generated Health Commons titles or summaries require expectation updates:
  `browser-vault-dashboard-pages`, `health-commons-experiment-detail-page`, and `experiment-detail-private-run`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` for this active-work notice only

## Constraints

- Preserve unrelated dirty-tree edits, especially the already-modified dry-sauna protocol file.
- Coordinate carefully with the active Norwegian 4x4 Health Commons patch lane and do not revert or overwrite its intent.
- Keep the landing narrow to user-facing copy; do not widen into schema, loader, or runtime behavior changes.
- Avoid exposing personal identifiers in any written artifacts or commit text.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/health-commons`
- `pnpm test:smoke`
- Direct readback of the touched Health Commons content and generated catalog outputs
Status: completed
Updated: 2026-04-21
Completed: 2026-04-21
