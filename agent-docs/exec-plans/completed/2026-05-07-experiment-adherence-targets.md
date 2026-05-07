# Experiment adherence targets

Status: completed
Created: 2026-05-07
Updated: 2026-05-08

## Goal

- Implement day-level experiment adherence targets as the frozen run-level source of truth for results calendars and adherence summaries.
- Show planned target days as satisfied/partial/missed/unknown/scheduled from canonical vault evidence instead of assuming all adherence means intervention sessions against a legacy schedule.

## Success criteria

- `runPlan.adherenceTargets` is contract-owned, validated, and additive to legacy run-plan fields.
- Query code evaluates day-level target calendars from run-level targets, counting all same-day evidence and never creating cells for unplanned logs.
- Existing legacy schedule/session experiments still read through a synthesized adherence target fallback.
- Browser results use the adherence projection for the results calendar and summary aliases without exposing broad raw event attributes.
- The web results UI renders neutral day-level adherence states, including missed days, without exposing `excused` in v1.
- Protocol-backed start/hydration can write exact daily defaults into the run when Health Commons provides safe defaults, while the run remains the frozen source of truth.
- Focused tests cover daily sauna, two-count daily partials, metric threshold unknown/missed behavior where supported, legacy fallback, and browser/web projection behavior.

## Scope

- In scope:
  - Contracts, query, browser replica, vault-usecases/CLI hydration, focused web results adapters/components, and focused tests.
  - Day-level calendars only: `targetCountPerDay` can express expected count per day, but no dose-time identity.
  - Linked event count and metric threshold/presence evidence shapes in contracts/evaluator.
  - Neutral statuses: scheduled, satisfied, partial, missed, failed, unknown.
- Out of scope:
  - Alcohol or other daily-state target hydration until the canonical evidence source is chosen.
  - Excused/override behavior and UI.
  - Persisted planned occurrence rows.
  - Arbitrary browser event-field selectors.
  - Free-text schedule parsing into red misses.

## Constraints

- Technical constraints:
  - Canonical experiment truth belongs in vault records under existing core/write paths; query/browser projections stay derived.
  - Preserve legacy schedule/session fields and readers during migration.
  - Avoid broad raw event replication to browsers; add only narrow derived evidence if needed.
  - Preserve unrelated dirty worktree edits, especially active hosted and experiment CLI typed-surface work.
- Product/process constraints:
  - Commons may provide defaults, but each run owns the exact adherence target used for evaluation.
  - Avoid shame-heavy wording; UI labels should be neutral even when the internal state is `missed` or `failed`.

## Risks and mitigations

1. Risk: Event-kind-only linked evidence becomes ambiguous for multi-target experiments.
   Mitigation: Accept this for v1 single-target/default cases and keep a clear future seam for target-bound evidence facts.
2. Risk: Existing schedules regress while migrating to adherence targets.
   Mitigation: Synthesize a legacy session target when `adherenceTargets` is absent and keep focused regression tests.
3. Risk: Browser projection widens private health event detail.
   Mitigation: Evaluate from already safe linked-event/metric rows or a narrow derived evidence fact, not raw event attributes.

## Tasks

1. Done: Inventory current contracts/query/browser/web/CLI experiment paths and tests.
2. Done: Add contract schemas/types and generated schema artifacts for adherence targets.
3. Done: Implement a shared pure query evaluator for day-level adherence targets and legacy fallback.
4. Done: Wire root experiment progress/outcome and browser replica results to prefer adherence targets.
5. Done: Wire protocol/CLI run creation hydration for safe daily defaults and preserve run-level frozen targets.
6. Done: Update web result adapters/components/types for neutral adherence statuses and no `excused` v1 display.
7. Done: Run required verification/audits and complete the handoff path.

## Decisions

- Store exact targets on `runPlan.adherenceTargets`; Health Commons defaults are copied into the run.
- V1 is day-level only; no planned dose-time identity.
- Skip alcohol/daily-state hydration for now.
- Do not expose `excused` in v1.
- Do not create calendar cells for unplanned logs.
- Legacy fallback only synthesizes day-level session adherence from an explicit legacy schedule. Rollup-only `sessionsPerWeek` does not create planned missed days.
- Browser Results only evaluates browser-safe intervention-session adherence targets for now. Unsupported explicit targets block legacy fallback instead of being replaced by a synthetic schedule target.
- Web schedule rendering shows baseline days plus planned target cells only; it does not add rest/upcoming cells.

## Verification

- Passed:
  - `pnpm --dir packages/contracts generate`
  - `pnpm --dir packages/contracts test:vitest -- experiment-run-schedule-intent`
  - `pnpm --dir packages/query test -- experiment-adherence browser-vault-experiment-results browser-vault-replica`
  - `pnpm --dir packages/cli test -- packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts`
  - `pnpm --dir apps/web test -- experiment-detail-private-run`
  - `pnpm typecheck`
  - `pnpm test:smoke`
- Caveat:
  - `pnpm test:diff <task paths>` still fails in `packages/health-commons/test/runtime.test.ts` because the generated biomarker browse index no longer contains `sleep-quality`; this task does not touch Health Commons catalog generation.
- Audits:
  - simplify, security/privacy, coverage-write, frontend-review, and task-finish-review ran.
  - Follow-up fixes landed for unsupported browser targets, target rollup progress, same-day UI cells, no rollup-only daily inference, browser-safe projection, cell expansion cap, and neutral UI wording.
Completed: 2026-05-08
