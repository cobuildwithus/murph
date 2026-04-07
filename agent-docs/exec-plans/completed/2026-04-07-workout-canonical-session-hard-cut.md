# Hard-cut workouts to one canonical nested session payload

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Hard-cut workout persistence so `activity_session` owns one canonical nested `workout` session payload for all rich workout detail, while top-level workout fields remain summary-only query helpers and workout formats become template-only compile inputs.

## Success criteria

- New and edited workout writes persist rich detail only under the nested `workout` payload, with top-level `activityType`, `durationMinutes`, and `distanceKm` treated as summary fields.
- Workout-format template storage and log flows compile into the canonical nested workout payload instead of duplicating rich detail as sibling durable truth.
- Contracts, core, assistant/CLI, query-facing reads, and durable docs all agree on the new ownership model.
- Required verification passes for the touched workout packages, plus at least one direct CLI scenario proving the canonical write shape.

## Scope

- In scope:
- `packages/contracts/**` workout event/template contracts and examples
- `packages/core/**` workout event and workout-format write/read ownership
- `packages/assistant-engine/**` workout/workout-format/workout-read flows
- `packages/query/**` workout-format metadata/read behavior when needed by the hard cut
- `docs/contracts/**`, `ARCHITECTURE.md`, and related data-model docs touched by the ownership change
- Out of scope:
- New device-provider integrations
- New workout families beyond `activity_session`
- Body-measurement model redesign beyond keeping its media/artifact handling out of workout truth ownership

## Constraints

- Technical constraints:
- Preserve `activity_session` as the canonical event family; do not introduce a second canonical workout record family.
- Keep top-level summary fields available for query ergonomics, but treat them as denormalized summaries rather than co-equal workout truth.
- Preserve unrelated dirty worktree edits and re-read overlapping files before each edit.
- Product/process constraints:
- Greenfield hard cut is allowed; remove compatibility-era duplicate truth where possible instead of adding new fallback lanes.
- Follow the repo high-risk workflow: plan, verification, direct proof, required audit pass, scoped commit.

## Risks and mitigations

1. Risk: existing workout/template reads or docs may still assume top-level `strengthExercises` or template-side rich detail are durable truth.
   Mitigation: update contract docs/tests and remove or demote duplicate rich-detail fields in the same pass.
2. Risk: simple freeform workout capture could lose enough information to build the canonical nested payload.
   Mitigation: synthesize a minimal nested `workout` payload for freeform captures so every new workout event still has one canonical nested shape.
3. Risk: current assistant/media helpers also cover body measurements and raw manifests.
   Mitigation: keep the staging infrastructure shared, but keep canonical product truth boundaries explicit in contracts/docs.

## Tasks

1. Update workout-related contracts/examples/docs so one nested workout payload is the durable workout truth and workout formats are template-only.
2. Hard-cut core event and workout-format ownership to the canonical nested workout/template payloads plus summary fields.
3. Update assistant workout/workout-format/workout-read flows to synthesize, persist, and read the canonical nested payload consistently.
4. Refresh tests and query-facing metadata/read paths that rely on the old duplicate rich-detail ownership.
5. Run focused verification and direct CLI scenario proof, then complete the required audit and scoped commit flow.

## Decisions

- Keep `activity_session` as the canonical event family and store rich workout detail under nested `workout`.
- Keep top-level `activityType`, `durationMinutes`, and `distanceKm` as summary/query helpers only.
- Keep workout formats under `bank/workout-formats/**`, but treat them as templates that compile into the canonical nested session payload.
- Treat the cut as greenfield: do not add read-time compatibility for legacy top-level workout detail, and require structured workout-format payloads to supply canonical nested `template`.

## Verification

- Passed:
- `pnpm exec vitest run packages/core/test/health-bank.test.ts -t 'workout formats' --no-coverage`
- `pnpm exec vitest run packages/query/test/health-registry-definitions.test.ts -t 'bank entity projections normalize food and workout format metadata through the shared seam' --no-coverage`
- `pnpm exec vitest run packages/importers/test/device-providers.test.ts --no-coverage`
- `pnpm exec vitest run --config vitest.config.ts test/cli-expansion-provider-event-samples.test.ts -t 'event scaffold keeps activity_session aligned with the canonical nested workout shape|workout format save rejects structured payloads that omit canonical template detail' --no-coverage` (run from `packages/cli`)
- Direct scenario proof:
- Source CLI `workout add` against a temp vault wrote an `activity_session` ledger line with summary top-level fields plus nested `workout.exercises[...]`, with no top-level `strengthExercises`.
- Source CLI `workout format save` from freeform text wrote nested `template.plannedSets[...]` into the saved workout-format markdown.
- Unrelated blockers observed:
- `pnpm typecheck:packages` fails outside this task in `packages/core/src/mutations.ts` and `packages/core/src/vault.ts`.
- `pnpm clean:build:test-runtime && pnpm exec tsc -b tsconfig.test-runtime.json --noCheck --pretty false` became blocked by an unrelated syntax error in `packages/cli/src/commands/model.ts`.
- `pnpm exec vitest run packages/cli/test/cli-expansion-workout.test.ts --no-coverage` was previously green for the workout-hard-cut cases after rebuilding artifacts, but later broader reruns were blocked by the unrelated CLI build issue above and by an adjacent rawRefs/manifest regression outside this task's changed seams.
Completed: 2026-04-07
