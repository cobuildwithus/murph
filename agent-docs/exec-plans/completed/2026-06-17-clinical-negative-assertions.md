# Clinical Negative Assertions

## Goal

Give Murph a canonical way to store negative clinical assertions such as NKDA and NKFA with source/date context, and teach onboarding not to save those facts only as freeform memory.

## Success Criteria

- NKDA/NKFA-style facts have a typed canonical vault record shape.
- The write path uses existing core-owned canonical mutation surfaces.
- Onboarding prompt guidance routes these facts to the typed surface before memory.
- Focused tests prove contract validation, CLI write/read behavior, and prompt guidance.

## Constraints

- Work on `main` in the current worktree per user request.
- Preserve unrelated dirty files from other active lanes.
- Do not touch generated CLI artifacts already owned by overlapping work unless unavoidable.
- Keep the design minimal and avoid a new registry if an existing canonical event path is sufficient.

## Plan

1. Inspect allergy, event, query, and onboarding surfaces. Completed.
2. Add a typed `clinical_assertion` event kind for negative allergy assertions. Completed.
3. Add focused contract/core/query/CLI/prompt regression coverage. Completed.
4. Run required verification and audits. Completed.
5. Finish with a scoped commit. Pending.

## Decision

Use canonical `kind: "clinical_assertion"` event records for NKDA/NKFA-style facts. Do not model these as allergy records and do not store them only in memory. The supported write path is `vault-cli event import-json`; `event scaffold` is intentionally unchanged to avoid widening generated CLI discovery for this narrow behavior.

## Verification

- Focused contract, core, query, CLI, and assistant prompt tests passed.
- ReviewGPT flagged the health export/context seam; `readHealthContext` now reads health-history event ledger rows directly, with an unmocked clinical assertion regression proving the fact appears in `health.healthEvents` and not `health.allergies`.
- ReviewGPT's public event-import concern was already covered by the `PUBLIC_EVENT_WRITE_KIND_LIST` update and focused CLI `event import-json` test.
- Local security/privacy, coverage/proof, and final task-review audit passes completed; the accepted coverage gap was closed, and the scaffold concern was rejected because `event scaffold` is intentionally not the supported write path.
- `pnpm typecheck` passed after the final export-context change.
- `pnpm test:smoke` passed after the final export-context change.
- Diff-scoped verifier passed affected package checks through `apps/cloudflare verify`, then failed in unrelated `apps/web/test/hosted-auth-panel.test.ts` text expectation. No `apps/web` files are in this task diff.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
