# Prevent ambiguous calendar and weekday automation authoring

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Goal

- Prevent the assistant from saving calendar-day and weekday cron restrictions that it can mistake for an intersection.
- Outcome: finite weekday reminders recur on weekdays and expire at the requested cutoff.
- Reaches: hosted automation creation and schedule replacement through the shared model tool contract.
- Proof: deterministic admission and scheduling checks, followed by a focused real-Codex edit journey.

## Success criteria

- Ambiguous cron writes fail before mutation with actionable repair guidance.
- Correct weekday, monthly, and annual schedules remain accepted; legacy records remain readable and pausable.
- The real assistant makes one versioned schedule edit and truthfully confirms the result.

## Scope

- In scope: assistant authoring validation, existing schedule/cutoff guidance, regression tests, owner documentation, and changelog.
- Out of scope: changing canonical cron semantics, introducing a scheduling abstraction, migrating existing records, or deploying.

## Constraints

- Keep the existing cron evaluator and canonical persisted schema unchanged.
- Reuse activeUntil for expiration and the current validation feedback path for repair.
- Use only synthetic evidence in committed artifacts.

## Risks and mitigations

1. Rejecting legacy records during unrelated edits would prevent useful repairs.
   Mitigation: validate only a supplied replacement schedule; retain canonical read/operator compatibility.
2. A prompt-only fix could repeat the same error.
   Mitigation: enforce the rule in the shared runtime authoring parser.

## Tasks

1. Add focused authoring regression cases and reproduce the failure.
2. Constrain model-authored cron and explain recurrence versus expiration.
3. Verify deterministic behavior, package types, and one real-model journey.
4. Update durable guidance and member changelog, review the diff, and commit the scoped change.

## Decisions

- Standard cron combines restricted day-of-month and day-of-week fields with OR. Preserve that canonical behavior; require a literal wildcard in one of those fields for assistant-authored cron.

## Verification

- Red proof: the new create and patch rejection cases failed against the previous authoring schema.
- `pnpm --filter @murphai/assistant-engine test test/assistant-automation-model-input-schema.test.ts test/assistant-dynamic-tool-failure-boundary.test.ts test/assistant-cron-schedule-store.test.ts`: 98 passed. Rejected writes never reach the owner port; the corrected recurrence skips the weekend.
- `pnpm --filter @murphai/assistant-engine test test/assistant-codex-tool-input-contract.test.ts test/assistant-hosted-domain-tools.test.ts`: 41 passed, 4 existing skipped. Actual pinned App Server conversion preserves the tool contract across eager native, deferred native, and code mode.
- `pnpm --filter @murphai/assistant-engine typecheck`: passed.
- `pnpm --dir apps/web changelog:generate`, then `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx`: 10 passed. The documented app-directory invocation found no tests; the existing Frog entry now also records fresh-checkout preparation.
- `pnpm docs:drift` and `git diff --check`: passed.
- `pnpm complexity:diff`: passed; one production source file, maximum complexity remains 17, no hotspots over 20.
- `pnpm test:assistant:live -- --test 'changes a finite calendar reminder to weekdays while preserving its cutoff' --codex-home <ALTERNATE_CODEX_HOME>`: passed with gpt-5.6-terra via local subscription after the permitted pre-action profile fallback. Exactly one inspect and one successful versioned patch; weekday recurrence, wall-clock time, and cutoff preserved; the actual evaluator returns Monday as the next occurrence.
- Product UX: Ready. Reviewed the synthetic reply: concise confirmation of weekdays, local time, and the existing end date, with no internal terminology or invented queued-work explanation.

## Candidate review

- One shared authoring schema owns both save and patch admission. Existing cron syntax validation, cutoff field, versioned mutation port, and feedback transport are reused.
- No dependency, persisted schema, scheduler, queue, routing, or delivery changes. No database, network, or awaited work is added.
- Canonical OR schedules remain valid outside model authoring. An unrelated patch does not resubmit or reject the stored schedule.
- Release note: `weekday-reminder-scheduling`. Deployment and existing-record repair remain outside this code-change scope.
- Parent review found no additional state owner or needed abstraction. Focused proof and a scoped local commit complete this task; PR publication and its external review/CI gates are separate.
Completed: 2026-09-13
