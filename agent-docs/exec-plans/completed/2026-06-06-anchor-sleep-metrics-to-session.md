Goal (incl. success criteria):
- Fix daily wearable sleep summaries so sleep-stage and sleep-duration metrics for a day come from the selected primary sleep session instead of a same-day nap or unrelated sleep resource.
- Add regression coverage for a day with both an overnight Oura sleep session and an acknowledged nap.

Constraints/Assumptions:
- Query code is read-only and must not mutate canonical vault data.
- Preserve unrelated active work and dirty files.
- Keep the fix narrow in `packages/query`.
- Avoid logging or fixture content with direct personal identifiers.

Key decisions:
- Anchor daily sleep metrics to the selected sleep window/resource after `resolveSleepWindowSelection` chooses the primary window.
- Preserve day-level or unanchored sleep metrics as fallback only when they are not tied to a different sleep window.
- Aggregate sleep-stage stream samples under the matching sleep window when a known window matches by resource or timestamp overlap; keep old day-level aggregation for unwindowed stage samples.

State:
- Implemented and verified; scoped commit closure in progress.

Done:
- Read repo routing docs, device-sync triage docs, and coordination ledger.
- Added session-anchoring selection for sleep metrics in `packages/query/src/wearables.ts`.
- Carried sleep-window external refs through window candidates and projected summaries.
- Added sleep-stage window-aware aggregation in `packages/query/src/wearables/candidates.ts`.
- Added regressions for direct Oura long-sleep plus nap metrics and sleep-stage-stream long-sleep plus nap metrics.
- Accepted and fixed final-review finding that sleep-stage aggregates initially erased session anchors.
- Accepted and fixed final-review finding that date-filtered summaries could drop pre-midnight stages before window-aware aggregation.
- Accepted coverage-write addition proving a nap-tied sleep score does not displace the day-level sleep score.
- Ran focused wearable tests, query coverage, workspace typecheck, and smoke checks successfully.
- Final task review returned no findings after the accepted fixes.

Now:
- Run scoped diff hygiene checks and create scoped commit.

Next:
- Close the active plan through `scripts/finish-task`.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/query/src/wearables.ts`
- `packages/query/src/wearables/types.ts`
- `packages/query/src/wearables/candidates.ts`
- `packages/query/src/wearables/selection.ts`
- `packages/query/src/projection/wearable-summary-compose.ts`
- `packages/query/test/wearables-sleep-session-anchor.test.ts`
- `packages/query/test/wearables-candidates-final.test.ts`
- `packages/query/test/wearables-coverage-branches.test.ts`
- `packages/query/test/wearables-selection-shared-final.test.ts`
- `packages/query/test/wearables-source-health-final.test.ts`
- `pnpm vitest run packages/query/test/wearables-sleep-session-anchor.test.ts packages/query/test/wearables-selection-shared-final.test.ts packages/query/test/wearables-candidates-final.test.ts packages/query/test/wearables-coverage-branches.test.ts packages/query/test/wearables-source-health-final.test.ts` passed.
- `pnpm --dir packages/query test:coverage` passed.
- `pnpm typecheck` passed.
- `pnpm test:smoke` passed.
- `pnpm test:diff ...` was attempted earlier and failed in unrelated CLI help/parity tests outside the query sleep selector change.
Status: completed
Updated: 2026-06-06
Completed: 2026-06-06
