Goal (incl. success criteria):
- Add a read-only hosted dashboard page where a member can see the durable context Murph already has about them.
- Do not change canonical storage or introduce a new data structure in this pass; use existing structured vault records and local mock records to shape the UI.
- Success means `/context` loads from the encrypted browser-vault snapshot for real data, supports a local mock mode for equipment/access UI shaping, handles empty/loading/error states, and focused tests cover the page.

Constraints/Assumptions:
- Keep canonical truth where it already lives: existing structured records for supplements, goals, experiments, conditions, providers, and similar facts.
- Keep the page read-only in this task; editing and canonical resource modeling are later tasks.
- Avoid assistant runtime state and chat transcript reconstruction.
- Preserve existing browser-vault privacy boundaries: only expose data already intended for the authenticated member's browser vault.
- Preserve unrelated active ledger rows and working-tree edits.

Key decisions:
- Shape equipment/access as a local mocked resource list first, then later add a proper structured snapshot projection once the UI model is clearer.
- Continue using existing browser-vault entity families for supplements, goals, experiments, and health context.

State:
- Complete. Implemented read-only `/context` page over existing structured vault records plus local mock equipment/access data.

Done:
- Added the `/context` dashboard page and sidebar navigation.
- Added local mock mode for equipment/access resources via `/context?mock=1` outside production.
- Added structured sections for equipment/access, supplements/meds, goals, experiments, and health context.
- Added focused tests for the real structured page path and local mock resource path.

Now:
- Ready for scoped commit.

Next:
- Iterate locally on `/context?mock=1`, then add a proper structured resource/access projection to the browser-vault snapshot once the UI shape is settled.

Open questions (UNCONFIRMED if needed):
- None blocking. Future edit/forget flows are intentionally out of scope for v1.

Working set (files/ids/commands):
- apps/web/app/(dashboard)/**
- apps/web/test/browser-vault-*.test.tsx
- pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/browser-vault-dashboard-pages.test.tsx
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01
