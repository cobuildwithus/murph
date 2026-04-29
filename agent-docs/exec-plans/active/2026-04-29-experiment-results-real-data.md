# Wire real experiment results data into the Results tab

Status: active
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Replace the Results tab's hand-built mock private-run data with a real `ExperimentRunProjection` derived from the current browser-vault replica.
- Keep the Results UI projection-driven: BrowserVault/query code computes real progress, outcome, schedule, trend, and summary data; `apps/web` maps that data into `ExperimentRunProjection`; React components render that projection without querying BrowserVault directly.
- Add a source-backed expected range path for trend bands. The structured field should exist now, but ranges can be empty/null until Health Commons research backs numeric values.
- Add a structured planned schedule source on the experiment run plan, using a run-specific `runPlan.schedule` subset plus actual logged `intervention_session` events. This is a greenfield hard cut: stop using the old free-text schedule as data.

## Success criteria

- The production Results tab no longer accepts `?mock=active` or `?mock=finished` as a data source, and `buildMockPrivateRun` / `buildMockSchedule` are deleted or moved behind an explicit non-production demo seam.
- `resolveBrowserVaultExperimentRun` returns real `signals`, `trends`, `summary`, `summaryDetail`, `conclusions`, and optional `schedule` from current browser-vault replica data for active and finished runs.
- Trend `expectedRange` is populated only when structured numeric expected-effect metadata is present and revision/source-backed; otherwise the chart renders without an expected band while the expected-effect record remains present.
- Planned schedule cells can be rendered from the run-plan schedule subset only: `{ kind: "dailyLocal"; localTime; timeZone }` or `{ kind: "cron"; expression; timeZone }`, plus actual intervention events. The old free-text schedule string is not a data source.
- `ScheduleCellKind` includes `completed`, `partial`, `missed`, `skipped`, `scheduled`, and `rest`/`upcoming` as needed by the current UI. Partial and skipped sessions are not collapsed into completed/missed.
- Every protocol/test-plan biomarker remains represented in selector output, including unsupported or no-data biomarkers. Unsupported biomarkers do not get fake chart/card values.
- A single high-level browser query selector is exported through `@murphai/query/browser`: `selectBrowserVaultExperimentResults(client, lookup, { asOf }): BrowserVaultExperimentResultsView | null`. Client code does not import server-only query or vault-reader paths.
- No matching private run returns `null`, not a diagnostics object. Diagnostics exist only after a matching run is found.
- Raw event rows stay internal to the selector. The exported result returns higher-level biomarker, schedule, progress, outcome, and diagnostics data only.
- The schedule hard cut updates every writer and artifact in the same PR: contract examples, generated contract schemas, onboarding apply/usecase writers, Health Commons onboarding targets/defaults, CLI options, CLI/generated metadata if applicable, and tests. No repo writer should continue producing legacy string `runPlan.schedule`.
- Tests prove active baseline, active intervention, finished with enough data, finished with sparse data, no expected range, no schedule, and structured cron/dailyLocal schedule cases.

## Current repair focus

- Fix session-event inclusion around local-date boundaries by resolving timestamped session events in the run schedule time zone before `asOf` filtering.
- Treat date-only `asOf` values as local dates for run-schedule expansion instead of UTC-midnight instants.
- Rank every supported active run status ahead of newer completed/stopped matching runs.
- Compute adherence `expectedSessionsByNow` from structured schedule cells when a run has a schedule, falling back to proportional target math only when no structured schedule exists.
- Let numeric expected-effect ranges inherit parent source keys when the range itself omits them, and format converted percent/delta ranges with the measured biomarker unit rather than the range's relative unit.

## Scope

- In scope:
  - Browser-vault experiment selectors under `packages/query/src/browser-replica/**`.
  - Browser replica safe projections needed for experiment metric windows, family-specific structured event detail, internal run-linked events, and planned schedule rows.
  - `apps/web/src/lib/browser-vault/experiment-run.ts` projection shaping.
  - `apps/web/src/types/experiments.ts` type adjustments if real data makes existing fields optional.
  - Results tab mock removal in `apps/web/app/(dashboard)/experiments/[experimentId]/results/results-tab-client.tsx`.
  - Contract extraction for shared schedule-intent ownership if needed to avoid package-local import cycles, while keeping a narrower experiment-run schedule subset.
  - Focused query, contracts, and hosted-web tests for the changed seams.
- Out of scope:
  - New chart designs or broad Results tab redesign.
  - Inventing numeric expected ranges from copy, mock data, or qualitative protocol descriptions.
  - Importing root `@murphai/query` analysis directly into client code when that pulls server-only or privacy-sensitive assumptions.
  - Scheduled-log execution/reminder integration for the first Results migration.
  - Rendering blood-pressure values or trends until the query metric resolver has a real BP metric source. The planned BP biomarker should still stay represented as unavailable/unsupported.

## Constraints

- Technical constraints:
  - Compute from the current browser-vault replica by default. Use `client.replica.generatedAt` as the default `asOf`, not wall-clock `new Date()`.
  - Do not use `selectBrowserVaultTrackedExperiments` as the detail lookup source; that path is capped for overview. Detail selectors should search replica entities directly by experiment id, slug, protocol ref, commons key, and aliases.
  - Browser-safe selectors should use projected `metricRows` / `metricDayRows` as metric truth. The root experiment helpers rely on raw attributes that the browser replica intentionally strips.
  - Browser event projection may include family/kind-specific structured session/context fields that are useful for Results analysis: `experimentId`, `experimentSlug`, `interventionType`, `protocolId`, `regimenId`, `sessionStatus`, `durationMinutes`, `timing`, `temperatureC`, `afterExercise`, `symptoms`, `confounders`, `contextType`, and `severity`.
  - Keep raw events internal to query. Export higher-level result objects plus diagnostics, not the raw event list.
  - Do not add these fields to the global BrowserVault `projectSafeAttributes` allowlist. Project them only for the relevant event family/kind rows.
  - Do not widen browser replica entity attributes wholesale to raw notes, raw provider provenance, raw external refs/ids, or full markdown bodies just to make analysis easier.
  - Keep package dependencies acyclic and one-way. Do not import assistant-engine cron helpers into query/browser code.
- Product/process constraints:
  - Health Commons owns public reusable protocol/test-plan expectations. BrowserVault owns private user run state and logged outcomes.
  - Expected-effect records need source keys, confidence/caveats, and revision participation. The field can exist with an empty/null numeric range; if the range source is absent, omit the band rather than showing an approximate band.
  - Schedule precision should be honest. The intended cadence is structured `runPlan.schedule`; if it is absent or invalid, show logged sessions and run windows, not invented weekdays.
  - Preserve private-run freshness: persisted outcome artifacts may be used later when projected and version-matched, but this plan prefers recomputing active and finished result projections from the current replica.

## Findings Against Current Code

1. The UI seam is already mostly right.
   `composeExperimentDetail` forwards `schedule`, `signals`, `trends`, `summary`, `summaryDetail`, and `conclusions` from the private run. `TrendChart` hides missing `expectedRange`, and `ResultsTab` omits missing `schedule`. The page can stay projection-driven.

2. The mock branch is production-accessible.
   `results-tab-client.tsx` reads `?mock=active|finished`, fabricates all result data, and suppresses BrowserVault loading/error state. This must not remain as the acceptance path for real wiring.

3. The real resolver is skeletal.
   `apps/web/src/lib/browser-vault/experiment-run.ts` matches the private run and computes status/day/timeline/next step, but returns empty `signals` and `trends`, no schedule, and fallback summary/conclusion copy.

4. Deterministic experiment analysis exists, but not on the browser seam.
   `packages/query/src/experiments.ts` has progress/outcome/window logic. It is exported from root `@murphai/query`, not from `@murphai/query/browser`, and it depends on raw read-model attributes that the browser replica does not fully project.

5. Structured schedules already have a contract, but are not run-linked enough.
   `packages/contracts/src/scheduled-log.ts` supports `ScheduleIntent` with `at`, `every`, `cron`, and `dailyLocal`, plus `intervention_session.add`. Scheduled-log execution writes an intervention event, but it currently links by optional `protocolId`, not exact `experimentId` / `experimentSlug`.

6. Scheduled logs are not available in the browser replica.
   `packages/query/src/scheduled-logs.ts` can query scheduled-log markdown from a vault root, but `BrowserVaultReplica` has no safe scheduled-log rows. With `runPlan.schedule` becoming canonical, this is no longer an MVP blocker for Results; scheduled logs can become the reminder/execution layer later.

7. Numeric expected ranges do not exist for sauna today.
   The Finnish sauna protocol has qualitative `expectedSignalDescriptions`, and the contract supports qualitative expected signal copy. The mock's numeric expected bands are not source-backed and should not graduate into real Results.

8. Current desired-direction analysis can overclaim.
   `analysisPlan.desiredDirection` is global today, while the sauna content treats some signals as mixed/contextual. Expected direction and expected range should become per-biomarker and nullable/watch-only where appropriate.

9. Persisted outcome artifacts exist, but are not enough for this plan's first source of truth.
   Experiment frontmatter can carry `outcome` / `outcomeRef`, and usecases can write outcome artifacts, but the browser replica does not project outcome artifact contents. Use persisted artifacts later as a cache or provenance layer after they are safely projected and version-matched.

10. Unsupported biomarkers need a first-class state.
    The sauna test plan includes morning blood pressure, while the current query metric resolver does not support BP. That should produce an unavailable/unsupported biomarker result, not disappearance from the result model.

11. Schedule-intent schemas need lower-level ownership before `runPlan.schedule` can use a subset.
    The current schedule-intent schema lives in `packages/contracts/src/scheduled-log.ts`, while `scheduled-log.ts` imports schemas from `packages/contracts/src/zod.ts`. Since `experimentRunPlanSchema` also lives in `zod.ts`, a hard cut to `runPlan.schedule: ExperimentRunScheduleIntent` should first move schedule-intent schemas/types to a lower-level contracts module that both `zod.ts` and `scheduled-log.ts` can import.

12. Schedule writers and generated artifacts must move with the schema.
    Current examples, CLI onboarding options, usecase onboarding writers, and generated contract schemas still encode `runPlan.schedule` as text. A schema-only hard cut would leave repo tools producing invalid experiment records.

13. Health Commons onboarding targets are part of the schedule-writing surface.
    The hard cut needs to update protocol/onboarding targets and defaults alongside contracts, generated schemas, CLI, and vault-usecase writers so Health Commons does not keep emitting legacy text schedules.

14. BrowserVault attribute projection is currently global.
    `packages/query/src/browser-replica/build.ts` uses `projectSafeAttributes` for entity attributes. The migration should not broaden that global allowlist for all entities; it should add family/kind-specific event projection for the structured experiment-session/context fields Results needs.

## Target Architecture

```text
current BrowserVaultReplica
  -> @murphai/query/browser selectBrowserVaultExperimentResults(...)
       - run lookup
       - metric windows
       - progress/outcome snapshot
       - internal run-linked intervention events
       - local-date schedule cells from runPlan.schedule
       - source-backed expected effects/ranges
  -> apps/web browser-vault projection mapper
  -> ExperimentRunProjection
  -> composeExperimentDetail
  -> ResultsTab
```

The Results tab remains a rendering surface. The projection mapper is the only app layer that knows how query-domain output maps to cards, trend charts, schedule cells, running summaries, and conclusions.

Raw event rows are an implementation detail inside the selector. The app-facing query result exposes the derived biomarker, schedule, progress, outcome, and diagnostics surfaces that the web projection mapper needs.

## Decisions

1. Return nullable for no matching private run.
   `selectBrowserVaultExperimentResults(...)` should return `BrowserVaultExperimentResultsView | null`. A missing run is not an analysis diagnostic; diagnostics are meaningful only after a private run has been found. Raw events stay internal.

2. Compute from the current replica first.
   Active and finished Results should recompute from browser-vault replica rows for freshness. Persisted `outcomeRef` can be a later optimization only when its artifact is safely projected and can be checked against the current run/test-plan revision.

3. Add source-gated expected ranges.
   Expected ranges should live in Health Commons test-plan or analysis-model metadata, not in BrowserVault or app UI. The metadata should include biomarker key, unit, value scale, low/high range, day/window, direction, confidence, source keys, and caveats.

4. Use a run-specific structured schedule subset, not the full scheduled-log union.
   Store intended cadence on the experiment run as either `dailyLocal` or five-field `cron`, both with required `timeZone`. Keep `at` and `every` available for scheduled logs if they still need them, but do not allow them in `runPlan.schedule` until Results has honest cell semantics for them.

5. Expand schedules by local date.
   Results needs cells such as Tue/Thu/Sat, not generic UTC instants. Expand run schedules by looping local dates in the run window, matching supported cron weekday lists or daily cadence, and producing local schedule cells. Use local time only for grace semantics.

6. Preserve exact session statuses in schedule cells.
   Add `partial` and `skipped` to `ScheduleCellKind` now. Actual session events win over planned cells, and `partial` / `skipped` should stay distinct instead of being folded into `completed` / `missed`.

7. Omit unknowns.
   If a run has no structured schedule, omit `schedule`. If a trend has no numeric expected range, omit `expectedRange`. If a biomarker lacks resolver support, keep it in selector output as `unsupported_source`, `unavailable`, or `no_data`, do not render fake values, and mention limitations in summary/conclusion copy where useful.

8. Keep browser privacy boundaries.
   Add minimal safe replica fields/selectors plus structured session/context fields where useful. Scope those fields by BrowserVault entity family/kind instead of using a bigger global allowlist. Continue excluding raw notes, raw provider refs, external ids, and full markdown bodies unless a specific feature needs them and a privacy review approves it.

## MVP Shape

Start with one app-facing query contract:

```ts
selectBrowserVaultExperimentResults(
  client,
  lookup,
  { asOf },
): BrowserVaultExperimentResultsView | null
```

`apps/web` should call this one selector from `resolveBrowserVaultExperimentRun` and then map its result to `ExperimentRunProjection`. Lower-level helpers for run lookup, events, metric windows, biomarkers, progress, outcome, schedule expansion, and expected effects should stay internal until another caller genuinely needs them.

Suggested browser-query types:

```ts
type BrowserVaultExperimentResultsLookup =
  | string
  | {
      experimentId?: string;
      slug?: string;
      protocolKeys?: readonly string[];
    };

interface BrowserVaultExperimentResultsOptions {
  asOf?: string;
}

interface BrowserVaultExperimentResultsView {
  asOf: string;
  experiment: BrowserVaultExperimentResultRun;
  biomarkers: BrowserVaultExperimentBiomarkerResult[];
  schedule: BrowserVaultExperimentScheduleResult | null;
  progress: BrowserVaultExperimentProgressResult | null;
  outcome: BrowserVaultExperimentOutcomeResult | null;
  diagnostics: BrowserVaultExperimentResultDiagnostic[];
}
```

The selector should default `asOf` from `client.replica.generatedAt`, not wall-clock time. `lookup` should not depend on `apps/web` protocol types; the app can pass protocol lookup keys built from Health Commons route id/key/aliases. No matching private run returns `null`. Once a run is found, diagnostics can describe unsupported biomarkers, unsupported schedules, sparse data, or inconsistent event/run-plan facts.

Raw events should not be part of the exported result. The selector can use event rows internally to build schedule cells, progress, and outcome.

For MVP, biomarker statuses stay in this query result. Do not add `ExperimentRunProjection.biomarkers` unless the UI needs a visible missing-biomarkers section now. Unsupported or unavailable biomarkers can affect summary/detail/conclusion copy without expanding the Results UI contract.

## Implementation Plan

### Phase 1: Browser-native experiment results selector

Create a browser-safe query module, likely `packages/query/src/browser-replica/experiments.ts`, exported through `packages/query/src/browser-replica.ts` and `packages/query/src/browser.ts`.

Export one selector first:

- `selectBrowserVaultExperimentResults(client, lookup, { asOf })`

Internal helpers can be added in the same module, but should not be exported initially:

- `findBrowserVaultExperimentRun`
- `selectBrowserVaultExperimentEventsForRun`
- `collectBrowserVaultExperimentMetricWindows`
- `buildBrowserVaultExperimentBiomarkers`
- `buildBrowserVaultExperimentProgress`
- `buildBrowserVaultExperimentOutcome`
- `buildBrowserVaultExperimentSchedule`

Implementation notes:

- Search `client.replica.entities` directly for the matching experiment. Do not depend on the capped overview list.
- Use `metricRows` / `metricDayRows` for baseline and intervention windows.
- Use a family/kind-specific BrowserVault event projection for `intervention_session` and relevant context events. Include structured fields needed for analysis: `experimentId`, `experimentSlug`, `interventionType`, `protocolId`, `regimenId`, `sessionStatus`, `durationMinutes`, `timing`, `temperatureC`, `afterExercise`, `symptoms`, `confounders`, `contextType`, and `severity`.
- Do not solve event projection by adding those keys to the global `projectSafeAttributes` allowlist. Tests should prove they appear only on relevant event rows and that raw notes, bodies, provider refs, and external ids stay excluded.
- Preserve every protocol/test-plan biomarker in selector output. Use explicit states like `available`, `no_data`, `unsupported_source`, and `unavailable` rather than dropping unresolved biomarkers.
- Return per-day points for trends as well as means/deltas, since `ExperimentMetricResult` currently summarizes windows without chart-ready points.
- Keep browser result types narrow and app-agnostic. `apps/web` should still own formatting labels and card copy.
- Add parity tests against root query analysis only for fields supported by safe browser rows.

### Phase 2A: Hard-cut run-plan schedule to a daily/cron subset

Add structured intended cadence to the experiment run itself so Results can render honest planned cells without depending on scheduled-log execution being configured.

Required changes:

- Extract schedule-intent contracts into a lower-level module, for example `packages/contracts/src/schedule-intent.ts`, so both `packages/contracts/src/zod.ts` and `packages/contracts/src/scheduled-log.ts` can import them without a cycle.
- Move/export the existing full scheduled-log schedule union from that lower-level module, including `at`, `every`, `cron`, and `dailyLocal`, so scheduled logs can keep their current schedule semantics.
- Add a narrower run-plan schedule schema/type in the same owner module, for example `experimentRunScheduleIntentSchema` / `ExperimentRunScheduleIntent`, containing only `dailyLocal` and `cron`.
- Change `experimentRunPlanSchema` to use `schedule: ExperimentRunScheduleIntent` when schedule is present. Do not keep the free-text string as a data-compatible variant, and do not allow `at` or `every` in experiment run plans.
- Require `timeZone: string` for both run-plan variants.
- Update `packages/contracts/src/examples.ts` and regenerated contract schema artifacts in the same PR so generated output no longer advertises a string schedule.
- Update onboarding writers in `packages/vault-usecases/src/usecases/experiment-journal-vault.ts` and `packages/cli/src/commands/experiment.ts` in the same PR so they parse/emit `ExperimentRunScheduleIntent`, not text.
- Update Health Commons onboarding targets/defaults in the same PR so generated or authored protocol setup data emits structured `ExperimentRunScheduleIntent`, not text.
- Update CLI/generated metadata and directly coupled CLI tests so `experiment apply-onboarding` cannot silently write legacy string `runPlan.schedule`.
- Add a residue test or `rg`-based verification target that fails on new experiment-run writer paths assigning a string to `runPlan.schedule`.

```ts
type ExperimentRunScheduleIntent =
  | { kind: "dailyLocal"; localTime: string; timeZone: string }
  | { kind: "cron"; expression: string; timeZone: string };
```

Example:

```ts
runPlan.schedule = {
  kind: "cron",
  expression: "0 8 * * 2,4,6",
  timeZone: "America/New_York",
};
```

- Add a pure schedule expansion helper for `ExperimentRunScheduleIntent` local dates over a bounded date window. Keep it in a low-level query/contracts-safe place, not in assistant-engine.
- Make Results schedule expansion local-date based:
  - loop local dates across the baseline/intervention display window using the schedule `timeZone`
  - support `dailyLocal`
  - support five-field cron expressions with concrete minute/hour, wildcard day-of-month and month, and day-of-week lists like `2,4,6`
  - produce local schedule dates/cells, not generic UTC occurrence instants
  - avoid a generic cron engine until product emits more complex run schedules
  - reject `at`, `every`, and complex cron features at the run-plan schema or parser boundary instead of returning them as unsupported run-plan schedules
- Update onboarding apply/CLI/tests/examples to stop accepting/storing a plain-language schedule string. For CLI input, prefer run-plan-specific flags such as `--schedule-kind dailyLocal|cron`, `--schedule-cron`, `--schedule-local-time`, and `--schedule-time-zone`, or a JSON payload path that validates against `experimentRunScheduleIntentSchema`.
- Build schedule cells from:
  - baseline/intervention dates in `runPlan`
  - planned local dates from structured run-plan schedule intent
  - actual run-linked `intervention_session` events
  - current replica `generatedAt` interpreted in the schedule timezone for today/current-state decisions

Cell rules:

- baseline window days become `baseline`
- future planned local date: `scheduled`
- today in the schedule timezone: `scheduled` unless an event says otherwise
- actual event on the same local day/window wins over inferred state
- completed event: `completed`
- partial event: `partial`
- missed event: `missed`
- skipped event: `skipped`
- past planned local date with no event: `missed` only after an explicit grace period; MVP default is 24 hours after the planned local time in the schedule timezone
- days outside planned/actual/baseline become `rest` or are omitted according to the current schedule component shape
- Extend `apps/web/src/types/experiments.ts` and the schedule component styles/legend to support `partial` and `skipped` cells.

### Later: Scheduled-log run linkage and browser projection

Scheduled logs should become the reminder/execution layer for the same run schedule, but Results should not need to wait on this layer if the run plan already carries schedule intent.

Required changes:

- Extend `intervention_session.add` scheduled-log action or scheduled-log metadata with optional `experimentId` and `experimentSlug` while preserving `protocolId`.
- Update scheduled-log execution so generated `intervention_session` events include `experimentId`, `experimentSlug`, a related experiment link, and `sessionStatus` where appropriate.
- Add a minimal browser-replica projection for scheduled logs or planned session rows. Include only safe fields: id/slug/title/status, schedule intent, action kind, intervention type, duration, protocol id, experiment id/slug, tags, and updated timestamp. Do not include bodies.
- Keep scheduled-log rows consistent with run-plan schedule intent where both exist, and fail closed or surface an inconsistency rather than silently choosing mismatched planned weekdays.

### Phase 3: Expected range source

Add structured expected-effect metadata to Health Commons test plans or a revisioned analysis model that participates in the selected run spec.

Suggested shape:

```ts
interface ExpectedExperimentEffect {
  biomarkerKey: string;
  label?: string;
  unit: string;
  scale: "absolute" | "delta" | "percent";
  direction: "increase" | "decrease" | "mixed" | "watch";
  range?: {
    startDay: number;
    endDay: number;
    low: number;
    high: number;
  };
  confidence: "low" | "moderate" | "high";
  sourceKeys: string[];
  caveats?: string[];
}
```

Rules:

- `range` is optional. Qualitative protocols can provide direction/caveats without a chart band.
- Add the structured expected-effect field as part of the migration even when all ranges are null/empty.
- Add tests proving empty, null, or absent ranges do not render an expected chart band.
- Per-biomarker direction replaces the current global `analysisPlan.desiredDirection` for expected-effect rendering.
- `mixed` / `watch` means do not label movement as expected improvement.
- Finnish sauna should initially render without numeric expected bands unless research/content adds source-backed values.
- Morning blood pressure stays represented as a planned/expected biomarker, but with `unsupported_source`, `unavailable`, or `no_data` until a real browser metric source and resolver exist.

### Phase 4: App projection mapper

Refactor `apps/web/src/lib/browser-vault/experiment-run.ts` or split it into projection helpers.

Projection outputs:

- `signals`: active runs use progress signals; finished runs use outcome metric results. Populate `expected` only from structured qualitative/expected-effect metadata. Consider making `ExperimentSignal.expected` optional if that matches the real data model.
- `trends`: map per-day baseline/intervention points, baseline average, current value, formatted delta, and optional source-backed `expectedRange`.
- `schedule`: build `ExperimentSchedule` only when structured planned schedule rows or honest logged-session/window data are available.
- `summary` / `summaryDetail`: active runs describe phase, coverage, and partiality; finished runs summarize outcome/confidence or sparse-data limitations.
- Unsupported biomarker statuses from the query result can inform `summaryDetail` and `conclusions`; do not add a new `ExperimentRunProjection.biomarkers` field unless the UI needs a visible missing-biomarkers section.
- `conclusions`: finished runs map outcome conclusion, confidence reasons, caveats, and metric results. Active runs keep conclusions gated until analysis is available.
- `timeline` / `nextStep`: preserve the existing status/date behavior and enrich only where real data supports it.

### Phase 5: Remove the mock seam

After real projection tests pass:

- Remove `useSearchParams` and `mockMode` handling from `results-tab-client.tsx`.
- Delete `buildMockPrivateRun` and `buildMockSchedule`.
- Stop suppressing BrowserVault error/status/retry in mock mode.
- Add a regression test or residue check that production Results behavior is not gated by `?mock=`.

## Risks and Mitigations

1. Risk: Results show authoritative-looking fake precision.
   Mitigation: omit `expectedRange` unless numeric values are source-backed and revisioned.

2. Risk: Free-text schedule parsing invents planned weekdays.
   Mitigation: hard-cut `runPlan.schedule` to the `ExperimentRunScheduleIntent` daily/cron subset; delete/stop using free-text schedule as run-plan data and never parse legacy strings into planned cells.

3. Risk: The schema hard cut lands before repo writers and generated artifacts move.
   Mitigation: require the schedule schema PR to update contract examples, generated schemas, onboarding usecase writers, CLI options/generated metadata, and directly coupled tests together; add a residue check for string schedule writers.

4. Risk: Browser selectors import server-only query paths.
   Mitigation: keep new selectors under `@murphai/query/browser`, update browser boundary tests, and add a client-bundle or import-graph check.

5. Risk: Schedule cells mark missed sessions too aggressively.
   Mitigation: require explicit missed-session semantics before coding; MVP marks an unlogged planned local date missed only after a 24-hour grace period after the planned local time in the schedule timezone.

6. Risk: Existing BrowserVault privacy projection widens too far.
   Mitigation: add family/kind-specific derived event rows and safe attributes rather than widening global `projectSafeAttributes`, with tests asserting raw notes/external refs/bodies are not projected.

7. Risk: Generic cron expansion creates timezone/DST churn before Results needs it.
   Mitigation: expand run schedules by local date only, with narrow weekday-list cron support and no generic cron engine in the MVP.

8. Risk: Finished Results become stale if persisted artifacts are preferred.
   Mitigation: recompute from current replica for this plan; only use persisted outcome artifacts later when the artifact is safely projected and version-matched.

## Tasks

1. Add the browser-native experiment results selector and tests in `packages/query`.
2. Extract shared schedule-intent contracts, then hard-cut `runPlan.schedule` to the `dailyLocal`/`cron` `ExperimentRunScheduleIntent` subset, including examples/generated schemas, onboarding writers, Health Commons onboarding targets/defaults, CLI writers, CLI/generated metadata, and tests in the same PR.
3. Add local-date run-plan schedule expansion with narrow cron/dailyLocal support, missed-session grace semantics, and `partial`/`skipped` schedule-cell support.
4. Add source-backed expected-effect/range metadata to Health Commons contracts/content flow, with nullable/empty ranges and no sauna numeric bands until the source exists.
5. Populate `ExperimentRunProjection` from `selectBrowserVaultExperimentResults` in `apps/web`.
6. Remove the Results tab mock branch and mock builders.
7. Run focused verification and required completion-workflow audits before implementation handoff.

## Parallel Landing Shape

Use GPT-5.5 xhigh workers only where the write set is disjoint or the dependency is already landed. Each worker is not alone in the codebase: preserve unrelated edits, do not revert work from other workers, and adjust to nearby changes instead of overwriting them.

Recommended batch order:

1. Batch A is the contract anchor and should be prepared first.
2. Batch E depends on Batch A and must land in the same hard-cut PR/landing unit as Batch A so no writer keeps emitting legacy string schedules.
3. Batches B and C can run after Batch A's public type/schema names are known.
4. Batch D should start after B and C are available, or draft against their expected helper names but not land before them.
5. Batch F is the integration close-out after B, C, D, and E land.

### Batch A: Contracts schedule hard cut

Purpose:

- Extract schedule-intent ownership and introduce the run-specific `ExperimentRunScheduleIntent` subset.
- Make `experimentRunPlanSchema.schedule` accept only `dailyLocal` and five-field `cron` with required `timeZone`.
- Keep scheduled logs on the full schedule union if they still need `at` / `every`.

Write set:

- `packages/contracts/src/schedule-intent.ts`
- `packages/contracts/src/scheduled-log.ts`
- `packages/contracts/src/zod.ts`
- `packages/contracts/src/examples.ts`
- `packages/contracts/generated/**`
- `packages/contracts/test/**`

Do not touch:

- `packages/query/**`
- `packages/vault-usecases/**`
- `packages/cli/**`
- `apps/web/**`

Prompt:

```text
You are a GPT-5.5 xhigh worker implementing Batch A of the experiment Results real-data plan. You are not alone in the codebase; do not revert unrelated edits or other workers' changes.

Goal: hard-cut experiment run plans to a run-specific schedule subset while preserving scheduled-log schedule behavior.

Implement:
- Extract schedule-intent schemas/types from scheduled-log ownership into a lower-level contracts module, likely packages/contracts/src/schedule-intent.ts.
- Preserve the full scheduled-log union for scheduled logs: at, every, cron, dailyLocal.
- Add ExperimentRunScheduleIntent / experimentRunScheduleIntentSchema with only:
  - { kind: "dailyLocal"; localTime: string; timeZone: string }
  - { kind: "cron"; expression: string; timeZone: string }
- Update experimentRunPlanSchema so runPlan.schedule uses ExperimentRunScheduleIntent, rejects legacy strings, rejects at/every, and requires timeZone.
- Update contract examples and generated schema artifacts.
- Add or update contract tests proving runPlan.schedule accepts dailyLocal/cron and rejects string/at/every.

Stay within the write set listed in the active plan. Run the focused contracts tests you touch and report exact commands/results.
```

### Batch B: BrowserVault event projection

Purpose:

- Add family/kind-specific BrowserVault projection for experiment-session/context event fields.
- Avoid widening global `projectSafeAttributes`.

Write set:

- `packages/query/src/browser-replica/build.ts`
- `packages/query/src/browser-replica/shared.ts` only if types need a narrow extension
- `packages/query/test/**` or existing browser-replica tests

Do not touch:

- `packages/contracts/**`
- `packages/query/src/browser-replica/experiments.ts`
- `apps/web/**`

Prompt:

```text
You are a GPT-5.5 xhigh worker implementing Batch B of the experiment Results real-data plan. You are not alone in the codebase; do not revert unrelated edits or other workers' changes.

Goal: project safe structured experiment-session/context event fields into BrowserVault rows by entity family/kind, not through a bigger global allowlist.

Implement:
- Inspect packages/query/src/browser-replica/build.ts and current BrowserVault replica tests.
- Keep raw events internal to query selectors; this batch only ensures the replica carries safe structured attributes on relevant event rows.
- Project at least these fields only for relevant event family/kind rows:
  experimentId, experimentSlug, interventionType, protocolId, regimenId, sessionStatus, durationMinutes, timing, temperatureC, afterExercise, symptoms, confounders, contextType, severity.
- Do not add these keys to a global projectSafeAttributes allowlist for all entities.
- Keep raw notes, markdown bodies, provider refs, external IDs, and raw provenance excluded.
- Add tests proving relevant event rows include the safe fields and unrelated rows do not receive them.

Stay within the write set listed in the active plan. Run focused query/browser-replica tests and report exact commands/results.
```

### Batch C: Local-date schedule expansion

Purpose:

- Add a pure local-date schedule expansion helper for `ExperimentRunScheduleIntent`.
- Support only `dailyLocal` and narrow weekday-list cron.

Write set:

- New query helper file under `packages/query/src/browser-replica/**`, preferably not `experiments.ts`
- A focused query test file for schedule expansion
- No public query exports unless the selector needs a private module import

Do not touch:

- `packages/contracts/**` except import the Batch A type/schema from public entrypoints
- `packages/query/src/browser-replica/experiments.ts`
- `apps/web/**`
- `packages/cli/**`

Prompt:

```text
You are a GPT-5.5 xhigh worker implementing Batch C of the experiment Results real-data plan. You are not alone in the codebase; do not revert unrelated edits or other workers' changes.

Goal: implement local-date run schedule expansion for Results, using the ExperimentRunScheduleIntent subset from Batch A.

Implement:
- Add a pure helper in packages/query/src/browser-replica/** that expands a bounded run window into planned local dates/cells.
- Support dailyLocal.
- Support five-field cron with concrete minute/hour, wildcard day-of-month and month, and day-of-week lists such as 2,4,6.
- Require timeZone from the schedule intent.
- Loop local dates in the run window and match supported weekdays. Do not use a generic cron engine and do not produce generic UTC occurrence instants.
- Apply semantics:
  - future local date: scheduled
  - today in schedule timezone: scheduled unless an event says otherwise
  - event on same local day/window wins
  - completed/partial/missed/skipped remain distinct
  - past planned local date with no event becomes missed only after the explicit grace period, MVP 24 hours after planned local time
- Add tests for dailyLocal, weekday-list cron, today/future/past, grace period, and event-wins behavior.

Stay within the write set listed in the active plan. Run focused query tests and report exact commands/results.
```

### Batch D: Browser experiment results selector

Purpose:

- Add the app-facing `selectBrowserVaultExperimentResults(...)` selector.
- Keep missing run as `null`, raw events internal, and biomarkers represented even when unsupported/no-data.

Write set:

- `packages/query/src/browser-replica/experiments.ts`
- `packages/query/src/browser-replica.ts`
- `packages/query/src/browser.ts`
- `packages/query/test/**`

Do not touch:

- `apps/web/**`
- `packages/contracts/**` beyond imports from public entrypoints
- `packages/cli/**`

Prompt:

```text
You are a GPT-5.5 xhigh worker implementing Batch D of the experiment Results real-data plan. You are not alone in the codebase; do not revert unrelated edits or other workers' changes.

Goal: export one high-level browser selector:
selectBrowserVaultExperimentResults(client, lookup, { asOf }): BrowserVaultExperimentResultsView | null

Implement:
- Add packages/query/src/browser-replica/experiments.ts and export it through @murphai/query/browser.
- Search client.replica.entities directly for the matching private run; do not use the capped tracked-experiment overview list.
- Default asOf from client.replica.generatedAt.
- Return null when no matching private run exists. Diagnostics are only for found runs.
- Keep raw event rows internal. Use them to build schedule/progress/outcome, but do not export an events array.
- Keep every protocol/test-plan biomarker in selector output with statuses such as available, no_data, unsupported_source, unavailable.
- Build trend-ready per-day points from metricRows/metricDayRows where supported.
- Integrate Batch C schedule expansion when available, but keep the selector app-agnostic.
- Add tests for no matching run, active baseline, active intervention, finished enough data, sparse data, unsupported biomarker, no expected range, and no schedule.

Stay within the write set listed in the active plan. Run focused query/browser tests and report exact commands/results.
```

### Batch E: Onboarding writers and Health Commons targets

Purpose:

- Stop every current run-plan writer from emitting legacy string schedules.
- Update Health Commons onboarding targets/defaults to emit structured run schedules.

Write set:

- `packages/vault-usecases/src/usecases/experiment-journal-vault.ts`
- `packages/cli/src/commands/experiment.ts`
- directly coupled CLI generated metadata/tests
- `packages/health-commons/content/protocols/**`
- `packages/health-commons/src/**`
- focused tests for CLI/usecase/Health Commons generation

Do not touch:

- `packages/contracts/**` except import the Batch A type/schema from public entrypoints
- `packages/query/**`
- `apps/web/**`

Prompt:

```text
You are a GPT-5.5 xhigh worker implementing Batch E of the experiment Results real-data plan. You are not alone in the codebase; do not revert unrelated edits or other workers' changes.

Goal: remove all current writers that produce legacy string runPlan.schedule and make onboarding write ExperimentRunScheduleIntent.

Implement:
- Update the vault-usecase onboarding apply path so schedule input is parsed/validated as ExperimentRunScheduleIntent, not a plain string.
- Update the CLI experiment onboarding path and generated metadata/tests so CLI cannot silently write string runPlan.schedule.
- Prefer run-plan-specific CLI flags: --schedule-kind dailyLocal|cron, --schedule-cron, --schedule-local-time, --schedule-time-zone, or a JSON payload path validated against the run-plan schedule schema.
- Update Health Commons protocol onboarding targets/defaults so authored/generated setup data emits structured dailyLocal/cron schedules.
- Add a residue test or focused rg-based verification that fails on new experiment-run writers assigning a string to runPlan.schedule.

Stay within the write set listed in the active plan. Run focused CLI/usecase/Health Commons tests and report exact commands/results.
```

### Batch F: Apps/web projection, UI, and mock removal

Purpose:

- Consume the new selector in `resolveBrowserVaultExperimentRun`.
- Add `partial` and `skipped` schedule-cell UI support.
- Remove production mock-mode Results data.

Write set:

- `apps/web/src/lib/browser-vault/experiment-run.ts`
- `apps/web/src/lib/experiments/experiment-detail.ts`
- `apps/web/src/types/experiments.ts`
- `apps/web/src/components/experiments/experiment-detail/experiment-schedule.tsx`
- `apps/web/src/components/experiments/experiment-detail/**`
- `apps/web/app/(dashboard)/experiments/[experimentId]/results/results-tab-client.tsx`
- focused apps/web tests

Do not touch:

- `packages/query/**` except imports from public `@murphai/query/browser`
- `packages/contracts/**`
- `packages/cli/**`

Prompt:

```text
You are a GPT-5.5 xhigh worker implementing Batch F of the experiment Results real-data plan. You are not alone in the codebase; do not revert unrelated edits or other workers' changes.

Goal: wire real browser experiment results into apps/web and remove the mock Results path.

Implement:
- Update resolveBrowserVaultExperimentRun to call selectBrowserVaultExperimentResults from @murphai/query/browser.
- Map selector output into ExperimentRunProjection: signals, trends, optional schedule, summary, summaryDetail, conclusions, timeline, and nextStep.
- Treat selector null as no private run.
- Keep unsupported/no-data biomarkers out of fake cards/charts, but let them inform summary/detail/conclusions where useful.
- Add partial and skipped to ScheduleCellKind and update the schedule component styles/legend without collapsing them into completed/missed.
- Remove ?mock=active / ?mock=finished branching, buildMockPrivateRun, buildMockSchedule, and mock-mode error suppression from results-tab-client.tsx.
- Add tests proving no expected range renders no band, partial/skipped cells render, no private run still works, and production Results is not gated by ?mock=.

Stay within the write set listed in the active plan. Run focused apps/web tests and report exact commands/results.
```

### Final Integration Owner

After worker batches land, the integrating agent should:

- Re-run generated artifacts once, if more than one batch touched generated files.
- Resolve import/export names around `ExperimentRunScheduleIntent`.
- Run `rg` checks for legacy string `runPlan.schedule`, lingering `?mock=` Results branches, and global BrowserVault projection widening.
- Run the strongest scoped verification available for the final changed paths.
- Run required completion workflow review passes for app/UI and health-data/browser-vault changes before handoff.

## Verification

Planning-only verification for this document:

- Read back this plan file.
- Check Markdown/diff whitespace for the touched plan file and coordination ledger.
- Scan touched docs for local personal identifiers and home-directory paths.

Implementation verification when this plan is executed:

- `pnpm --dir packages/contracts test -- scheduled-log`
- contracts generated-schema freshness check for experiment frontmatter/run plan
- contract tests proving `runPlan.schedule` rejects `at`, `every`, and legacy strings
- `pnpm --dir packages/query test -- experiment`
- schedule expansion tests for local dates, today/future/past cells, event-wins behavior, and weekday-list cron
- focused CLI/usecase tests proving onboarding writes structured `runPlan.schedule`
- Health Commons generation/check proving onboarding targets/defaults no longer emit string `runPlan.schedule`
- residue scan proving experiment run writers no longer emit string `runPlan.schedule`
- BrowserVault replica projection tests proving session/context fields are family/kind-scoped and raw notes/bodies/provider refs/external ids are excluded
- UI/type tests proving `partial` and `skipped` schedule cells render without collapsing into completed/missed
- focused browser-entry/boundary tests for `@murphai/query/browser`
- focused `apps/web` tests for BrowserVault private-run Results projection and Results tab rendering
- `bash scripts/workspace-verify.sh test:diff <changed paths>` or the package-specific stronger equivalent required by the verification docs
- Required completion workflow review passes for app/UI and health-data/browser-vault changes before handoff

## Working Set

- `packages/query/src/browser-replica/**`
- `packages/query/src/browser-replica/build.ts`
- `packages/query/src/browser.ts`
- `packages/query/src/browser-replica.ts`
- `packages/query/test/**`
- `packages/contracts/src/scheduled-log.ts`
- `packages/contracts/src/schedule-intent.ts`
- `packages/contracts/src/examples.ts`
- `packages/contracts/generated/**`
- `packages/contracts/src/health-commons.ts`
- `packages/contracts/src/zod.ts`
- `packages/cli/src/commands/experiment.ts`
- directly coupled CLI generated metadata/tests
- `packages/vault-usecases/src/usecases/experiment-journal-vault.ts`
- `packages/health-commons/content/protocols/**`
- `packages/health-commons/src/**`
- `apps/web/src/lib/browser-vault/experiment-run.ts`
- `apps/web/src/lib/experiments/experiment-detail.ts`
- `apps/web/src/types/experiments.ts`
- `apps/web/src/components/experiments/experiment-detail/experiment-schedule.tsx`
- `apps/web/app/(dashboard)/experiments/[experimentId]/results/results-tab-client.tsx`
- `apps/web/src/components/experiments/experiment-detail/**`
