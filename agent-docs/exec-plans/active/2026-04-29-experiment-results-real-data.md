# Wire real experiment results data into the Results tab

Status: active
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Replace the Results tab's hand-built mock private-run data with a real `ExperimentRunProjection` derived from the current browser-vault replica.
- Keep the Results UI projection-driven: BrowserVault/query code computes real progress, outcome, schedule, trend, and summary data; `apps/web` maps that data into `ExperimentRunProjection`; React components render that projection without querying BrowserVault directly.
- Add a source-backed expected range path for trend bands. The structured field should exist now, but ranges can be empty/null until Health Commons research backs numeric values.
- Add a structured planned schedule source on the experiment run plan, using `runPlan.schedule: ScheduleIntent` plus actual logged `intervention_session` events. This is a greenfield hard cut: stop using the old free-text schedule as data.

## Success criteria

- The production Results tab no longer accepts `?mock=active` or `?mock=finished` as a data source, and `buildMockPrivateRun` / `buildMockSchedule` are deleted or moved behind an explicit non-production demo seam.
- `resolveBrowserVaultExperimentRun` returns real `signals`, `trends`, `summary`, `summaryDetail`, `conclusions`, and optional `schedule` from current browser-vault replica data for active and finished runs.
- Trend `expectedRange` is populated only when structured numeric expected-effect metadata is present and revision/source-backed; otherwise the chart renders without an expected band while the expected-effect record remains present.
- Planned schedule cells can be rendered from `runPlan.schedule: ScheduleIntent` using the first emitted schedule subset: `dailyLocal` and five-field cron with weekday lists, plus actual intervention events. The old free-text schedule string is not a data source.
- Completed, missed, skipped, and partial session cells are based on run-linked `intervention_session` events from the current replica.
- Every protocol/test-plan biomarker remains represented in selector output, including unsupported or no-data biomarkers. Unsupported biomarkers do not get fake chart/card values.
- A single high-level browser query selector is exported through `@murphai/query/browser`: `selectBrowserVaultExperimentResults(client, lookup, { asOf }): BrowserVaultExperimentResultsView | null`. Client code does not import server-only query or vault-reader paths.
- No matching private run returns `null`, not a diagnostics object. Diagnostics exist only after a matching run is found.
- Raw event rows stay internal to the selector. The exported result returns higher-level biomarker, schedule, progress, outcome, and diagnostics data only.
- The schedule hard cut updates every writer and artifact in the same PR: contract examples, generated contract schemas, onboarding apply/usecase writers, Health Commons onboarding targets/defaults, CLI options, CLI/generated metadata if applicable, and tests. No repo writer should continue producing legacy string `runPlan.schedule`.
- Tests prove active baseline, active intervention, finished with enough data, finished with sparse data, no expected range, no schedule, and structured cron/dailyLocal schedule cases.

## Scope

- In scope:
  - Browser-vault experiment selectors under `packages/query/src/browser-replica/**`.
  - Browser replica safe projections needed for experiment metric windows, family-specific structured event detail, internal run-linked events, and planned schedule rows.
  - `apps/web/src/lib/browser-vault/experiment-run.ts` projection shaping.
  - `apps/web/src/types/experiments.ts` type adjustments if real data makes existing fields optional.
  - Results tab mock removal in `apps/web/app/(dashboard)/experiments/[experimentId]/results/results-tab-client.tsx`.
  - Contract extraction for shared `ScheduleIntent` ownership if needed to avoid package-local import cycles.
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
  - Browser event projection may include family-specific structured session/context fields that are useful for Results analysis: `sessionStatus`, `durationMinutes`, `timing`, `temperatureC`, `afterExercise`, `symptoms`, `confounders`, `contextType`, and `severity`.
  - Keep raw events internal to query. Export higher-level result objects plus diagnostics, not the raw event list.
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

11. `ScheduleIntent` needs lower-level contract ownership before `runPlan.schedule` can use it.
    The current schedule-intent schema lives in `packages/contracts/src/scheduled-log.ts`, while `scheduled-log.ts` imports schemas from `packages/contracts/src/zod.ts`. Since `experimentRunPlanSchema` also lives in `zod.ts`, a hard cut to `runPlan.schedule: ScheduleIntent` should first move the schedule-intent schemas/types to a lower-level contracts module that both `zod.ts` and `scheduled-log.ts` can import.

12. Schedule writers and generated artifacts must move with the schema.
    Current examples, CLI onboarding options, usecase onboarding writers, and generated contract schemas still encode `runPlan.schedule` as text. A schema-only hard cut would leave repo tools producing invalid experiment records.

13. Health Commons onboarding targets are part of the schedule-writing surface.
    The hard cut needs to update protocol/onboarding targets and defaults alongside contracts, generated schemas, CLI, and vault-usecase writers so Health Commons does not keep emitting legacy text schedules.

## Target Architecture

```text
current BrowserVaultReplica
  -> @murphai/query/browser selectBrowserVaultExperimentResults(...)
       - run lookup
       - metric windows
       - progress/outcome snapshot
       - internal run-linked intervention events
       - planned schedule from runPlan.schedule
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

4. Use structured schedules, not free text.
   Store intended cadence on the experiment run as `runPlan.schedule: ScheduleIntent`, such as cron plus timezone. Delete/stop using the old free-text schedule as data. Scheduled logs can become an execution/reminder layer later, but they should not block the Results migration.

5. Omit unknowns.
   If a run has no structured schedule, omit `schedule`. If a trend has no numeric expected range, omit `expectedRange`. If a biomarker lacks resolver support, keep it in selector output as `unsupported_source`, `unavailable`, or `no_data`, do not render fake values, and mention limitations in summary/conclusion copy where useful.

6. Keep browser privacy boundaries.
   Add minimal safe replica fields/selectors plus structured session/context fields where useful. Continue excluding raw notes, raw provider refs, external ids, and full markdown bodies unless a specific feature needs them and a privacy review approves it.

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
- Use a family-specific BrowserVault event projection for `intervention_session` and relevant context events. Keep the projection narrow and structured; do not export the raw event list from the selector result.
- Preserve every protocol/test-plan biomarker in selector output. Use explicit states like `available`, `no_data`, `unsupported_source`, and `unavailable` rather than dropping unresolved biomarkers.
- Return per-day points for trends as well as means/deltas, since `ExperimentMetricResult` currently summarizes windows without chart-ready points.
- Keep browser result types narrow and app-agnostic. `apps/web` should still own formatting labels and card copy.
- Add parity tests against root query analysis only for fields supported by safe browser rows.

### Phase 2A: Hard-cut run-plan schedule to `ScheduleIntent`

Add structured intended cadence to the experiment run itself so Results can render honest planned cells without depending on scheduled-log execution being configured.

Required changes:

- Extract schedule-intent contracts into a lower-level module, for example `packages/contracts/src/schedule-intent.ts`, so both `packages/contracts/src/zod.ts` and `packages/contracts/src/scheduled-log.ts` can import them without a cycle.
- Move/export `scheduleIntentKindValues`, `scheduleIntentAtSchema`, `scheduleIntentEverySchema`, `scheduleIntentCronSchema`, `scheduleIntentDailyLocalSchema`, `scheduleIntentSchema`, `formatScheduleIntentIssues`, `ScheduleIntentKind`, and `ScheduleIntent` from that lower-level module.
- Update scheduled-log contracts to import the shared schedule-intent schema.
- Change `experimentRunPlanSchema` to require structured `schedule: ScheduleIntent` when schedule is present. Do not keep the free-text string as a data-compatible variant.
- Add required `timeZone: string` to schedule-intent variants where local expansion needs it, especially `cron` and `dailyLocal`.
- Update `packages/contracts/src/examples.ts` and regenerated contract schema artifacts in the same PR so generated output no longer advertises a string schedule.
- Update onboarding writers in `packages/vault-usecases/src/usecases/experiment-journal-vault.ts` and `packages/cli/src/commands/experiment.ts` in the same PR so they parse/emit `ScheduleIntent`, not text.
- Update Health Commons onboarding targets/defaults in the same PR so generated or authored protocol setup data emits structured `ScheduleIntent`, not text.
- Update CLI/generated metadata and directly coupled CLI tests so `experiment apply-onboarding` cannot silently write legacy string `runPlan.schedule`.
- Add a residue test or `rg`-based verification target that fails on new experiment-run writer paths assigning a string to `runPlan.schedule`.

```ts
type ScheduleIntent =
  | { kind: "at"; at: string; timeZone?: string }
  | { kind: "every"; everyMs: number; timeZone?: string }
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

- Add a pure schedule expansion helper for `ScheduleIntent` occurrences over a bounded date window. Keep it in a low-level query/contracts-safe place, not in assistant-engine.
- Narrow Results schedule expansion aggressively for the first pass:
  - support `dailyLocal`
  - support five-field cron expressions with concrete minute/hour, wildcard day-of-month and month, and day-of-week lists like `2,4,6`
  - require `timeZone`
  - return an `unsupported_schedule` diagnostic for complex cron features, `at`, and `every` until the product actually emits them for run plans
- Update onboarding apply/CLI/tests/examples to stop accepting/storing a plain-language schedule string. For CLI input, prefer flags mirroring scheduled-log creation (`--schedule-kind`, `--schedule-cron`, `--schedule-local-time`, `--schedule-at`, `--schedule-every-ms`, `--schedule-time-zone`) or a JSON payload path that validates against `scheduleIntentSchema`.
- Build schedule cells from:
  - baseline/intervention dates in `runPlan`
  - planned occurrences from structured run-plan schedule intent
  - actual run-linked `intervention_session` events
  - current replica `generatedAt` for today/current-state decisions

Cell rules:

- baseline window days become `baseline`
- future planned occurrence: `scheduled`
- exact session status from a matching event wins over inferred state
- completed/partial event on the same local day/window: `completed`
- skipped/missed event on the same local day/window: `missed`, or `skipped` if the UI type is extended
- past planned occurrence with no event: `missed` only after an explicit grace period; MVP default is 24 hours after the planned occurrence time in the schedule timezone
- days outside planned/actual/baseline become `rest` or are omitted according to the current schedule component shape

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
   Mitigation: hard-cut `runPlan.schedule` to `ScheduleIntent`; delete/stop using free-text schedule as run-plan data and never parse legacy strings into planned cells.

3. Risk: The schema hard cut lands before repo writers and generated artifacts move.
   Mitigation: require the schedule schema PR to update contract examples, generated schemas, onboarding usecase writers, CLI options/generated metadata, and directly coupled tests together; add a residue check for string schedule writers.

4. Risk: Browser selectors import server-only query paths.
   Mitigation: keep new selectors under `@murphai/query/browser`, update browser boundary tests, and add a client-bundle or import-graph check.

5. Risk: Schedule cells mark missed sessions too aggressively.
   Mitigation: require explicit missed-session semantics before coding; MVP marks an unlogged planned occurrence missed only after a 24-hour grace period after the planned occurrence time in the schedule timezone.

6. Risk: Existing BrowserVault privacy projection widens too far.
   Mitigation: add narrow derived rows and safe attributes, with tests asserting raw notes/external refs/bodies are not projected.

7. Risk: Finished Results become stale if persisted artifacts are preferred.
   Mitigation: recompute from current replica for this plan; only use persisted outcome artifacts later when the artifact is safely projected and version-matched.

## Tasks

1. Add the browser-native experiment results selector and tests in `packages/query`.
2. Extract shared schedule-intent contracts, then hard-cut `runPlan.schedule` to `ScheduleIntent`, including examples/generated schemas, onboarding writers, Health Commons onboarding targets/defaults, CLI writers, CLI/generated metadata, and tests in the same PR.
3. Add run-plan schedule expansion helper with narrow cron/dailyLocal support and missed-session grace semantics.
4. Add source-backed expected-effect/range metadata to Health Commons contracts/content flow, with nullable/empty ranges and no sauna numeric bands until the source exists.
5. Populate `ExperimentRunProjection` from `selectBrowserVaultExperimentResults` in `apps/web`.
6. Remove the Results tab mock branch and mock builders.
7. Run focused verification and required completion-workflow audits before implementation handoff.

## Verification

Planning-only verification for this document:

- Read back this plan file.
- Check Markdown/diff whitespace for the touched plan file and coordination ledger.
- Scan touched docs for local personal identifiers and home-directory paths.

Implementation verification when this plan is executed:

- `pnpm --dir packages/contracts test -- scheduled-log`
- contracts generated-schema freshness check for experiment frontmatter/run plan
- `pnpm --dir packages/query test -- experiment`
- focused CLI/usecase tests proving onboarding writes structured `runPlan.schedule`
- Health Commons generation/check proving onboarding targets/defaults no longer emit string `runPlan.schedule`
- residue scan proving experiment run writers no longer emit string `runPlan.schedule`
- focused browser-entry/boundary tests for `@murphai/query/browser`
- focused `apps/web` tests for BrowserVault private-run Results projection and Results tab rendering
- `bash scripts/workspace-verify.sh test:diff <changed paths>` or the package-specific stronger equivalent required by the verification docs
- Required completion workflow review passes for app/UI and health-data/browser-vault changes before handoff

## Working Set

- `packages/query/src/browser-replica/**`
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
- `apps/web/app/(dashboard)/experiments/[experimentId]/results/results-tab-client.tsx`
- `apps/web/src/components/experiments/experiment-detail/**`
