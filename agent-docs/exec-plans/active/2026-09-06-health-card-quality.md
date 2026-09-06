# Health card quality and correctness

## Outcome

Finish the existing seven-day card, saved-view, and occurrence-inspection
journeys with truthful data, reliable state reporting, and polished presentation.
The current task owns the existing feature branch after the requested handoff.

## Product UX plan

- Effort: Product change.
- Promise: one readable view of the seven completed local calendar days, with
  observed averages and a neutral comparison to the preceding seven days.
  Today's unfinished activity must not masquerade as a completed-day decline.
- People: private-direct members with complete, sparse, duration-only sleep,
  or no wearable data; recipients of static Messages previews; people asking
  what happened to an automation whose text sent but a later part failed.
- Presentation: retain the shared cream card and neutral chart language;
  improve date hierarchy, value spacing, sparse-state context, and responsive
  design evidence. Preserve metric order and RMSSD/SDNN identity.
- Recovery: never call accepted partial dispatch unsent or claim handset
  delivery. Preserve known nap and unfinished-sleep exclusions.
- Exclusions: no new scheduler, state store, dependency, provider dispatch,
  rollout activation, merge, or deployment.

## Architecture and proof

Canonical wearable selection remains query-owned. Daily duration selection
must not inherit timing-analysis requirements. The existing cron receipt and
reconciliation owners derive accepted dispatch from persisted provider facts;
media cleanup retains its narrower evidence contract. Presentation continues
to consume the existing closed card contract.

1. Add focused regressions for duration-only sleep, completed local day bounds,
   and partial text dispatch before/after terminal reconciliation.
2. Fix those owner boundaries, preserving unrelated state and code.
3. Refine the production card and its synthetic design study; render complete,
   sparse, empty, long-date, and maximum-value cases with checked-in fonts.
4. Verify relevant tests, typechecks, lint, privacy, and diff checks. Inspect
   realistic phone sizes and the responsive study in Chromium.
5. Re-review changed boundaries, run the required focused assistant journey,
   then complete the repository PR/review workflow with exact-head evidence.

## Evidence and status

- Starting head: `1f05b8511d` (PR 2629), clean and matching remote.
- Review: three independent read-only passes identified sleep data omission,
  partial-text receipt misclassification, and cross-year header overflow.
- Baseline: 19 focused Web tests and 13 contract/operator tests passed.
- Implemented completed-day bounds and duration-only sleep selection; the new
  regressions failed before the fixes. Query/sleep/runtime: 25 tests passed.
- Implemented truthful partial dispatch before and after terminal reconciliation.
  Trusted card, automation tools, and occurrence receipts: 55 tests passed.
- Updated static presentation and text/Telegram comparison context. Web: 20
  tests passed, including cross-year and maximum-value real-font raster proof.
- Browser: actual design route passed at 320, 768, and 1280px. Four synthetic
  phone captures inspected; year header stays on one line.
- Query, assistant-engine, operator-config, and Web typechecks passed; focused
  Web ESLint and the complexity guard passed. Saved-view snapshot test passed.
- Three fresh independent reviews have no unresolved actionable findings.
- Focused real-assistant partial-send journey and final PR verification pending.
- Current-base merge proof found conflicts with newer main; reconcile once
  after preserving this tested implementation, then verify affected owners.

## Remaining delivery boundary

Keep wearable generation default-off. Physical Messages extension, macOS,
app-absent recovery, and VoiceOver proof remain activation requirements.
