# Workout data model cutover

## Goal

Land the greenfield workout data model cutover so Murph can store rich workout sessions in canonical `activity_session` events, structured reusable workout templates in markdown bank docs, and immutable workout CSV import batches with manifests under `raw/workouts/**`.

## Scope

- Expand contracts for nested workout session/template payloads and workout raw-import manifests.
- Thread the richer workout/template schema through core bank/event layers and query projections.
- Replace the thin CLI workout/workout-format implementation with structured session/template support plus workout show/list/manifest and CSV inspect/import commands.
- Keep the storage grammar simple: events in `ledger/events`, routines in `bank/workout-formats`, raw imports in `raw/workouts/**`.

## Non-goals

- No live Strong/Hevy API integrations.
- No social/profile workout features.
- No measurement/nutrition family expansion in this patch.

## Verification

- Focused TypeScript/package verification for touched packages when possible.
- Regenerate committed contract schemas / CLI command maps affected by the cutover.
- Completed focused verification:
  - `pnpm build:test-runtime:prepared`
  - `pnpm exec vitest run packages/cli/test/cli-expansion-workout.test.ts packages/core/test/health-bank.test.ts --no-coverage`
- Repo-wide verification attempted:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
  - All three stop in unrelated `apps/web` hosted-onboarding route/test typing failures already present in the dirty tree.

## Notes

- Greenfield cutover: prefer the new nested `workout` / `template` payloads as the source of truth while still keeping the existing top-level workout summary fields for timeline/query ergonomics.
- Follow-up fix: omit nested undefined fields when synthesizing workout-format templates from freeform capture so frontmatter serialization succeeds.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
