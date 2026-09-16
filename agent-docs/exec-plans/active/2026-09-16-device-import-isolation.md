# Isolate per-resource Junction validation failures and stop device import alert flapping

Status: active
Created: 2026-09-16
Updated: 2026-09-16

## Goal

- A single Junction resource whose response fails Murph-side validation (today:
  an ECG summary whose voltage samples cannot be bound) no longer fails the
  whole reconcile job, so the other resources in the window keep importing and
  the connection cannot exhaust its retry allowance on one recording.
- The device-import backlog notice stays one incident while the backlog is
  continuous. A quiet gap shorter than the evidence-continuity window can no
  longer clear the incident and let the next pass re-alert, bypassing the
  six-hour reminder.

## Success criteria

- Reconcile continuation test: an ECG binding failure records one
  `validation_incomplete` skip with the real error code, the other resource in
  the same window imports, and no reconcile proof is written.
- Existing resource-kind ECG tests still reject (their retry contract is
  unchanged).
- Health evaluator test: ten-minute retry passes evaluated at every five-minute
  check stay `backlog.anomalous` until the gap exceeds the 15-minute
  continuity threshold; an overdue wake with stale evidence is a stall, not a
  backlog.
- Focused Web and device-syncd tests, package typecheck, and
  `pnpm complexity:diff` pass.

## Scope

- In scope: `device-import-health.ts` eligibility/backlog condition;
  `junction.ts` reconcile timeseries continuation unit failure handling and the
  skipped-resource warn/metadata shape; RELIABILITY.md owner text; tests.
- Out of scope: the incident state machine in `incident-email-monitor.ts`;
  resource-kind retention for validation failures (open PR #3501); the live
  cause of the ECG mismatch (needs #3501's diagnostics); replaying already-dead
  jobs in production.

## Constraints

- Technical constraints: reuse the existing skipped-optional-resource seam
  (warn log, metadata patch, proof withholding). No new queue, state owner, or
  follow-up job kind. Complexity debt above 20 must not increase.
- Product/process constraints: no partial recording is ever reported as
  complete; the skipped resource is re-fetched on the next reconcile because
  proof is withheld.

## Risks and mitigations

1. Risk: the skip hides a persistent provider-side defect because the reconcile
   completes.
   Mitigation: the warn log carries the real error code and reason token, and
   `junctionSkippedResourceLast` metadata names the resource; PR #3501 adds the
   empty-versus-mismatch diagnostics.
2. Risk: widening backlog eligibility from ten to fifteen minutes delays a
   legitimate recovery signal by up to five minutes.
   Mitigation: recovery is still observed on the next drained checkpoint; the
   change only prevents flapping between passes.

## Tasks

1. Health evaluator: share the 15-minute continuity threshold between evidence
   reset and eligibility; require current evidence for the backlog notice;
   drop the redundant two-passes-in-twenty-minutes count. Add the flap
   regression test.
2. Junction provider: classify `JUNCTION_ECG_RECORDING_BINDING_INCOMPLETE` as
   an isolated validation failure inside the reconcile continuation unit,
   record it through the skipped-resource seam, and continue. Add the
   reconcile isolation test.
3. Update RELIABILITY.md owner text for both behaviors.
4. Focused tests, typecheck, complexity guard, `pnpm test:diff`; PR body and
   changelog decision.

## Decisions

- Isolation lives in `executeFullJobTimeseriesContinuationUnit`, the reconcile
  path the live failure used, not in the shared per-chunk fetch: the shared
  function also serves resource-kind jobs, whose retry contract PR #3501 owns.
- No follow-up resource job is scheduled for the skipped resource; withheld
  proof already re-fetches the window on the next reconcile.
- The alert fix aligns eligibility with evidence continuity instead of adding
  an incident "hold" state to the shared email-incident owner.
- Codex implementation lanes were unavailable (revoked token on one home,
  usage caps on the others), so implementation and review ran on the parent
  model.

## Verification

- Commands to run: `pnpm --dir apps/web test:prepared apps/web/test/hosted-device-import-health.test.ts apps/web/test/hosted-device-import-alert-monitor.test.ts`;
  `pnpm --dir packages/device-syncd exec vitest run test/junction-provider-resources.test.ts -t ECG`;
  `pnpm --dir packages/device-syncd typecheck`; `pnpm complexity:diff`;
  `pnpm test:diff <changed paths>`.
- Expected outcomes: all pass; complexity debt unchanged.
