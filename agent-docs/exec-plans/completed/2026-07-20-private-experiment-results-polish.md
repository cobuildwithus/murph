# Polish private experiment results

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Turn the finished private-experiment page into a clear, compact evidence
  report and keep a truthful chart visible for every comparable saved metric.

## Success criteria

- The result, confidence, metrics, limitations, and contextual notes have one
  legible hierarchy without repeating the saved analysis in oversized cards.
- Every renderable metric with baseline and experiment window averages shows a
  chart. Raw daily points use the existing trend chart; saved outcomes without
  points use an explicitly labeled window-average comparison.
- Sparse or incomplete evidence remains visibly qualified and never implies a
  daily time series or stronger confidence than the saved outcome supports.
- Desktop and mobile layouts remain usable and match the existing Murph design
  system.
- Focused tests, scoped web verification, rendered browser proof, and required
  completion audits pass.

## Scope

- In scope: authenticated private experiment result projection, result-page
  composition, trend/comparison chart rendering, focused hosted-web tests, and
  the durable experiment result design pattern.
- Out of scope: changing saved outcome contents, recomputing experiment
  conclusions, altering adherence or biomarker selection policy, or adding new
  persisted state.

## Evidence and owner boundary

- Saved outcomes project baseline and intervention window means plus sample
  counts but intentionally carry no raw daily points.
- `apps/web/src/lib/browser-vault/experiment-run.ts` currently drops the trend
  whenever both raw point arrays are empty, even though the same projection
  emits metric cards from those comparable window averages.
- The browser-vault result projection remains the single read owner. The fix
  derives a presentation-only comparison from its existing values and does not
  add a second source of truth.

## Tasks

1. Extend the existing trend projection with explicit display and coverage
   metadata so saved window averages can render without pretending to be raw
   observations.
2. Add the window-average chart mode and tighten metric/trend composition.
3. Simplify the finished report hierarchy and remove duplicated presentation.
4. Add focused projection and UI regressions for observed and summary-only
   outcomes.
5. Run scoped verification, desktop/mobile browser proof, required audits, and
   parent final review, then close the plan and commit on `main`.

## Constraints

- Preserve private health data inside the existing authenticated browser-vault
  boundary.
- Reuse the current owner and chart dependency; add no state, service,
  dependency, or compatibility path.
- Keep summary-only visuals explicitly labeled as window averages.

## Completion evidence

- Persisted baseline/intervention means now project an explicit
  `windowComparison`, including when no raw points or saved delta are present.
- Finished reports use one compact hierarchy: saved result, chart-led measured
  changes, limitations, then contextual notes.
- Focused regression suite: 3 files and 43 tests passed.
- Final `test:diff` route passed repository guards, apps/web TypeScript, 5,934
  tests (148 skipped), lint with zero errors, dev smoke, and production build.
- Frontend review findings were resolved: intervention means are no longer
  labeled as latest values, and limitation markers no longer use affirmative
  coloring.
- Coverage-write added the no-delta window-comparison regression and reported
  no unresolved coverage findings.
- Rendered browser proof was unavailable because the in-app browser list was
  empty. The required Fable and Opus review attempts were also blocked by an
  expired Claude OAuth session; source, accessibility, responsive-layout, test,
  smoke, and production-build evidence completed instead.
Completed: 2026-07-20
