# Wire real experiment results data into the Results tab

Status: active
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Replace the Results tab's hand-built mock private-run data with a real `ExperimentRunProjection` derived from the current browser-vault replica.
- Keep the Results UI projection-driven: BrowserVault/query code computes real progress, outcome, schedule, trend, and summary data; `apps/web` maps that data into `ExperimentRunProjection`; React components render that projection without querying BrowserVault directly.
- Add a source-backed expected range path for trend bands. The structured field should exist now, but ranges can be empty/null until Health Commons research backs numeric values.
- Add a structured planned schedule source on the experiment run plan, using a cron-like schedule intent plus actual logged `intervention_session` events. Scheduled-log run linkage remains valuable, but it is a second layer rather than the first blocker for Results.

## Success criteria

- The production Results tab no longer accepts `?mock=active` or `?mock=finished` as a data source, and `buildMockPrivateRun` / `buildMockSchedule` are deleted or moved behind an explicit non-production demo seam.
- `resolveBrowserVaultExperimentRun` returns real `signals`, `trends`, `summary`, `summaryDetail`, `conclusions`, and optional `schedule` from current browser-vault replica data for active and finished runs.
- Trend `expectedRange` is populated only when structured numeric expected-effect metadata is present and revision/source-backed; otherwise the chart renders without an expected band while the expected-effect record remains present.
- Planned schedule cells can be rendered from a structured `runPlan.scheduleIntent` / structured `runPlan.schedule` union using the existing schedule-intent semantics (`at`, `every`, `cron`, `dailyLocal`) plus actual intervention events. Legacy free-text schedule remains display/compatibility data only.
- Completed, missed, skipped, and partial session cells are based on run-linked `intervention_session` events from the current replica.
- Every protocol/test-plan biomarker remains represented in selector output, including unsupported or no-data biomarkers. Unsupported biomarkers do not get fake chart/card values.
- Browser query selectors are exported through `@murphai/query/browser`; client code does not import server-only query or vault-reader paths.
- Tests prove active baseline, active intervention, finished with enough data, finished with sparse data, no expected range, no schedule, and structured cron/dailyLocal schedule cases.

## Scope

- In scope:
  - Browser-vault experiment selectors under `packages/query/src/browser-replica/**`.
  - Browser replica safe projections needed for experiment metric windows, structured event detail, run-linked events, and planned schedule rows.
  - `apps/web/src/lib/browser-vault/experiment-run.ts` projection shaping.
  - `apps/web/src/types/experiments.ts` type adjustments if real data makes existing fields optional.
  - Results tab mock removal in `apps/web/app/(dashboard)/experiments/[experimentId]/results/results-tab-client.tsx`.
  - Focused query, contracts, and hosted-web tests for the changed seams.
- Out of scope:
  - New chart designs or broad Results tab redesign.
  - Inventing numeric expected ranges from copy, mock data, or qualitative protocol descriptions.
  - Importing root `@murphai/query` analysis directly into client code when that pulls server-only or privacy-sensitive assumptions.
  - Reworking all scheduled-log execution behavior beyond the run-linking and browser-projection fields needed here.
  - Rendering blood-pressure values or trends until the query metric resolver has a real BP metric source. The planned BP biomarker should still stay represented as unavailable/unsupported.

## Constraints

- Technical constraints:
  - Compute from the current browser-vault replica by default. Use `client.replica.generatedAt` as the default `asOf`, not wall-clock `new Date()`.
  - Do not use `selectBrowserVaultTrackedExperiments` as the detail lookup source; that path is capped for overview. Detail selectors should search replica entities directly by experiment id, slug, protocol ref, commons key, and aliases.
  - Browser-safe selectors should use projected `metricRows` / `metricDayRows` as metric truth. The root experiment helpers rely on raw attributes that the browser replica intentionally strips.
  - Browser projection may include structured session/context fields that are useful for Results analysis: `sessionStatus`, `durationMinutes`, `timing`, `temperatureC`, `afterExercise`, `symptoms`, `confounders`, `contextType`, and `severity`.
  - Do not widen browser replica entity attributes wholesale to raw notes, raw provider provenance, raw external refs/ids, or full markdown bodies just to make analysis easier.
  - Keep package dependencies acyclic and one-way. Do not import assistant-engine cron helpers into query/browser code.
- Product/process constraints:
  - Health Commons owns public reusable protocol/test-plan expectations. BrowserVault owns private user run state and logged outcomes.
  - Expected-effect records need source keys, confidence/caveats, and revision participation. The field can exist with an empty/null numeric range; if the range source is absent, omit the band rather than showing an approximate band.
  - Schedule precision should be honest. If no structured planned schedule exists, show logged sessions and run windows, not invented weekdays.
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
   `packages/query/src/scheduled-logs.ts` can query scheduled-log markdown from a vault root, but `BrowserVaultReplica` has no safe scheduled-log rows. Results cannot expand future planned cells from the current replica yet.

7. Numeric expected ranges do not exist for sauna today.
   The Finnish sauna protocol has qualitative `expectedSignalDescriptions`, and the contract supports qualitative expected signal copy. The mock's numeric expected bands are not source-backed and should not graduate into real Results.

8. Current desired-direction analysis can overclaim.
   `analysisPlan.desiredDirection` is global today, while the sauna content treats some signals as mixed/contextual. Expected direction and expected range should become per-biomarker and nullable/watch-only where appropriate.

9. Persisted outcome artifacts exist, but are not enough for this plan's first source of truth.
   Experiment frontmatter can carry `outcome` / `outcomeRef`, and usecases can write outcome artifacts, but the browser replica does not project outcome artifact contents. Use persisted artifacts later as a cache or provenance layer after they are safely projected and version-matched.

10. Unsupported biomarkers need a first-class state.
    The sauna test plan includes morning blood pressure, while the current query metric resolver does not support BP. That should produce an unavailable/unsupported biomarker result, not disappearance from the result model.

## Target Architecture

```text
current BrowserVaultReplica
  -> @murphai/query/browser experiment selectors
       - run lookup
       - metric windows
       - progress/outcome snapshot
       - run-linked intervention events
       - run-linked planned schedule rows
       - source-backed expected effects/ranges
  -> apps/web browser-vault projection mapper
  -> ExperimentRunProjection
  -> composeExperimentDetail
  -> ResultsTab
```

The Results tab remains a rendering surface. The projection mapper is the only app layer that knows how query-domain output maps to cards, trend charts, schedule cells, running summaries, and conclusions.

## Decisions

1. Compute from the current replica first.
   Active and finished Results should recompute from browser-vault replica rows for freshness. Persisted `outcomeRef` can be a later optimization only when its artifact is safely projected and can be checked against the current run/test-plan revision.

2. Add source-gated expected ranges.
   Expected ranges should live in Health Commons test-plan or analysis-model metadata, not in BrowserVault or app UI. The metadata should include biomarker key, unit, value scale, low/high range, day/window, direction, confidence, source keys, and caveats.

3. Use structured schedules, not free text.
   Store intended cadence on the experiment run in a structured schedule-intent shape, such as cron plus timezone. Use scheduled logs as an execution/reminder layer with exact run linkage, not as the only way Results can know the intended schedule.

4. Omit unknowns.
   If a run has no structured schedule, omit `schedule`. If a trend has no numeric expected range, omit `expectedRange`. If a biomarker lacks resolver support, keep it in selector output as `unsupported_source`, `unavailable`, or `no_data`, do not render fake values, and mention limitations in summary/conclusion copy where useful.

5. Keep browser privacy boundaries.
   Add minimal safe replica fields/selectors plus structured session/context fields where useful. Continue excluding raw notes, raw provider refs, external ids, and full scheduled-log bodies unless a specific feature needs them and a privacy review approves it.

## Implementation Plan

### Phase 1: Browser-native experiment selectors

Create a browser-safe query module, likely `packages/query/src/browser-replica/experiments.ts`, exported through `packages/query/src/browser-replica.ts` and `packages/query/src/browser.ts`.

Selectors to add:

- `selectBrowserVaultExperimentRun(client, lookup)`
- `selectBrowserVaultExperimentEvents(client, lookup)`
- `selectBrowserVaultExperimentMetricWindows(client, input)`
- `selectBrowserVaultExperimentProgress(client, input)`
- `selectBrowserVaultExperimentOutcome(client, input)`
- `selectBrowserVaultExperimentBiomarkers(client, input)`

Implementation notes:

- Search `client.replica.entities` directly for the matching experiment. Do not depend on the capped overview list.
- Use `metricRows` / `metricDayRows` for baseline and intervention windows.
- Preserve every protocol/test-plan biomarker in selector output. Use explicit states like `available`, `no_data`, `unsupported_source`, and `unavailable` rather than dropping unresolved biomarkers.
- Return per-day points for trends as well as means/deltas, since `ExperimentMetricResult` currently summarizes windows without chart-ready points.
- Keep browser result types narrow and app-agnostic. `apps/web` should still own formatting labels and card copy.
- Add parity tests against root query analysis only for fields supported by safe browser rows.

### Phase 2A: Run-plan structured schedule source

Add structured intended cadence to the experiment run itself so Results can render honest planned cells without depending on scheduled-log execution being configured.

Required changes:

- Add a structured run-plan schedule field, either as `runPlan.scheduleIntent` or by migrating `runPlan.schedule` from string to a structured union while preserving a legacy/display string path.
- Reuse the existing schedule intent semantics where possible:

```ts
type ExperimentRunScheduleIntent =
  | { kind: "at"; at: string; timeZone?: string }
  | { kind: "every"; everyMs: number; timeZone?: string }
  | { kind: "dailyLocal"; localTime: string; timeZone?: string }
  | { kind: "cron"; expression: string; timeZone?: string };
```

Example:

```ts
runPlan.schedule = {
  kind: "cron",
  expression: "0 8 * * 2,4,6",
  timeZone: "America/New_York",
};
```

- Add a pure schedule expansion helper for `ScheduleIntent` occurrences over a bounded date window. Keep it in a low-level query/contracts-safe place, not in assistant-engine. Support the cron subset the product writes first, such as five-field cron expressions with lists/ranges/steps, plus `dailyLocal`, `at`, and bounded `every`.
- Build schedule cells from:
  - baseline/intervention dates in `runPlan`
  - planned occurrences from structured run-plan schedule intent
  - actual run-linked `intervention_session` events
  - current replica `generatedAt` for today/current-state decisions

Cell rules:

- baseline window days become `baseline`
- actual completed/partial events become `completed`
- actual missed/skipped events become `missed` or a future `skipped` kind if the UI type is extended
- past planned occurrences with no event can become `missed` only if product semantics say the schedule is authoritative
- future planned occurrences become `scheduled`
- days outside planned/actual/baseline become `rest` or are omitted according to the current schedule component shape

### Phase 2B: Scheduled-log run linkage and browser projection

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
- Per-biomarker direction replaces the current global `analysisPlan.desiredDirection` for expected-effect rendering.
- `mixed` / `watch` means do not label movement as expected improvement.
- Finnish sauna should initially render without numeric expected bands unless research/content adds source-backed values.
- Morning blood pressure stays represented as a planned/expected biomarker, but with `unsupported_source`, `unavailable`, or `no_data` until a real browser metric source and resolver exist.

### Phase 4: App projection mapper

Refactor `apps/web/src/lib/browser-vault/experiment-run.ts` or split it into projection helpers.

Projection outputs:

- `signals`: active runs use progress signals; finished runs use outcome metric results. Populate `expected` only from structured qualitative/expected-effect metadata. Consider making `ExperimentSignal.expected` optional if that matches the real data model.
- `trends`: map per-day baseline/intervention points, baseline average, current value, formatted delta, and optional source-backed `expectedRange`.
- `biomarkers`: preserve test-plan biomarkers even when no card/chart can be rendered. Use explicit availability/status fields so the UI can explain unsupported or missing data without pretending a value exists.
- `schedule`: build `ExperimentSchedule` only when structured planned schedule rows or honest logged-session/window data are available.
- `summary` / `summaryDetail`: active runs describe phase, coverage, and partiality; finished runs summarize outcome/confidence or sparse-data limitations.
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
   Mitigation: use structured run-plan schedule intent / planned rows only; keep any legacy schedule string as display text and never parse it into planned cells.

3. Risk: Browser selectors import server-only query paths.
   Mitigation: keep new selectors under `@murphai/query/browser`, update browser boundary tests, and add a client-bundle or import-graph check.

4. Risk: Scheduled-log sessions do not count toward experiment progress.
   Mitigation: add exact experiment id/slug linkage to scheduled intervention actions and generated events.

5. Risk: Existing BrowserVault privacy projection widens too far.
   Mitigation: add narrow derived rows and safe attributes, with tests asserting raw notes/external refs/bodies are not projected.

6. Risk: Finished Results become stale if persisted artifacts are preferred.
   Mitigation: recompute from current replica for this plan; only use persisted outcome artifacts later when the artifact is safely projected and version-matched.

## Tasks

1. Add browser-native experiment selectors and tests in `packages/query`.
2. Add run-plan structured schedule support and a schedule expansion helper.
3. Add scheduled-log run linkage and safe browser-replica schedule projection.
4. Add source-backed expected-effect/range metadata to Health Commons contracts/content flow, with nullable/empty ranges and no sauna numeric bands until the source exists.
5. Populate `ExperimentRunProjection` from the new query selectors in `apps/web`.
6. Remove the Results tab mock branch and mock builders.
7. Run focused verification and required completion-workflow audits before implementation handoff.

## Verification

Planning-only verification for this document:

- Read back this plan file.
- Check Markdown/diff whitespace for the touched plan file and coordination ledger.
- Scan touched docs for local personal identifiers and home-directory paths.

Implementation verification when this plan is executed:

- `pnpm --dir packages/contracts test -- scheduled-log`
- `pnpm --dir packages/query test -- experiment`
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
- `packages/contracts/src/health-commons.ts`
- `packages/contracts/src/zod.ts`
- `packages/core/src/scheduled-logs.ts`
- `packages/vault-usecases/src/usecases/experiment-journal-vault.ts`
- `packages/health-commons/content/protocols/**`
- `apps/web/src/lib/browser-vault/experiment-run.ts`
- `apps/web/src/lib/experiments/experiment-detail.ts`
- `apps/web/src/types/experiments.ts`
- `apps/web/app/(dashboard)/experiments/[experimentId]/results/results-tab-client.tsx`
- `apps/web/src/components/experiments/experiment-detail/**`
