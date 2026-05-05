# First Session Prep Reminders

## Goal

Land v1 assistant guidance for automatically scheduling one-shot first-session prep reminders after experiment onboarding creates a run and resolves a usable first-session time.

Success criteria:

- Assistant onboarding guidance resolves first intervention session date/time when possible.
- A usable exact time or narrow time range leads to one canonical `automation save` job with `scheduleKind: "at"` for 15 minutes before the first session.
- The assistant does not ask a separate opt-in question for that first prep reminder.
- Prompt guidance keeps first-session prep distinct from missed-log follow-up and weekly digests.
- Notification decision guidance explicitly skips `experiment followup due` for first-session prep automations and instead reads the experiment plus protocol before send/skip.
- Focused tests or smoke scenario coverage prove the prompt/scenario contract.

## Product Behavior

- During experiment onboarding, the assistant should try to resolve the first planned intervention session date and time.
- If the user gives a usable exact time or narrow time range, the assistant should create the experiment run normally and then schedule one first-session prep automation automatically.
- The assistant should not ask a separate "do you want a reminder?" question for this first prep message when the time is already usable.
- The assistant should be transparent after the write, for example: it should tell the user the experiment was set up, name the scheduled prep check-in time, and say it can be cancelled or moved.
- If the user gives a broad or vague window such as "after work" or "this weekend," the assistant should ask one lightweight follow-up for a rough time before scheduling.
- If the user says they do not know the time yet, the assistant should create the run without a prep reminder and say they can give a time later.
- If a selected protocol expects a baseline window before the first intervention, the assistant should not silently treat a time like "tomorrow at 5" as session one. It should resolve whether the user wants to start baseline then or skip baseline and treat that time as the first intervention.

## Architecture

The v1 architecture should reuse existing primitives:

1. Health Commons protocol page supplies setup slots, plan defaults, first-session guidance, protocol steps, tips, and safety stop conditions.
2. Assistant onboarding resolves the first session day/time in the user's canonical timezone and current local date context.
3. Experiment creation writes the private run normally.
4. Existing experiment frontmatter fields store assistant support policy.
5. Existing onboarding `setupAnswers` can optionally store traceability timestamps and the automation slug.
6. Existing canonical automation records own the one-shot scheduled reminder.
7. Automation runtime runs the job once, passes the automation instructions into an `automation-cron` assistant turn, and archives successful one-shot jobs using existing behavior.
8. The scheduled assistant reads the experiment and protocol at send time, then sends or skips.

Do not add a separate first-session-prep schema object or experiment follow-up kind for v1.

## Data Shape

Use existing experiment `assistantSupport` fields:

```yaml
assistantSupport:
  reminderPolicy: "pre_session"
  reminderOptionId: "pre_session"
  remindersEnabled: true
  missedLogFollowup: "opt_in_only"
  weeklyDigestEnabled: true
```

Use existing arbitrary onboarding setup answers for traceability when available:

```yaml
onboarding:
  setupAnswers:
    first_session_start_at: "2026-05-06T17:00:00-04:00"
    first_session_prep_reminder_at: "2026-05-06T16:45:00-04:00"
    first_session_prep_automation_slug: "experiment-first-prep-finnish-sauna-2026-05-06"
```

Use canonical automation one-shot scheduling:

```bash
vault-cli automation save "First sauna prep" \
  --slug "experiment-first-prep-finnish-sauna-2026-05-06" \
  --schedule-kind at \
  --schedule-at "2026-05-06T16:45:00-04:00" \
  --channel "<current-channel>" \
  --tags assistant \
  --tags scheduled \
  --tags experiment \
  --tags first-session-prep \
  --tags finnish-sauna \
  --instructions "<scheduled instructions>"
```

Stable slug convention:

- `experiment-first-prep-<experiment-slug>-<YYYY-MM-DD>`
- Re-saving the same slug should update/reschedule the reminder rather than creating duplicates.

## Scheduled Automation Instructions

Each first-session prep automation should carry stable context without copying the full protocol page.

Required instruction shape:

```txt
This is a one-shot first-session prep reminder for experiment <experimentSlugOrId>.

Before deciding whether to send:
1. Read `vault-cli experiment show <experimentSlugOrId> --format json`.
2. Read `vault-cli commons protocol show <protocolRouteOrKey> --format json`.
3. Check whether the experiment is still active.
4. Check whether a first intervention session has already been logged for <firstSessionDate>.
5. Skip if the experiment is inactive, the session was already logged, the user cancelled/moved the reminder, or the saved plan no longer matches this scheduled first session.

If sending:
- Keep it brief and channel-appropriate.
- Mention this is the first session.
- Offer to walk the user through it.
- Include the protocol page's first-session guidance, key steps, and safety stop conditions.
- Do not dump the whole protocol.
- Do not imply failure or pressure.
- Use plain conversational wording.
```

## Prompt Changes

### Experiment Onboarding Guidance

Update `buildAssistantExperimentOnboardingGuidanceText()` in `packages/assistant-engine/src/assistant/system-prompt.ts`:

- Add a `# First-session prep reminders` section.
- Tell the assistant to resolve the first planned intervention session date/time during onboarding.
- Use canonical timezone and current local date context to resolve phrases like "tomorrow around 5."
- For exact times and narrow ranges, schedule one one-shot prep reminder after creating the run.
- Use a default lead time of 15 minutes unless the protocol page says otherwise.
- Do not ask a separate permission question for this first prep reminder once a usable time is resolved.
- Ask only one lightweight follow-up when the day/window is too broad.
- Keep first-session prep separate from missed-log follow-up and weekly digest.
- After scheduling, tell the user the reminder time and that it can be cancelled or moved.
- Resolve baseline-window ambiguity explicitly before treating a user-provided time as the first intervention session.

### Automation Guidance

Update the automation-related guidance in `packages/assistant-engine/src/assistant/system-prompt.ts`:

- Add first-session prep reminders as a one-shot `automation save` use case with `--schedule-kind at` and `--schedule-at <ISO timestamp>`.
- Recommend stable slugs like `experiment-first-prep-<experiment-slug>-<YYYY-MM-DD>`.
- Require automation instructions to read the saved experiment and Health Commons protocol page before sending.
- Clarify that protocol-level `askBeforeCreatingAutomations` applies to recurring or post-session support, not the automatic first-session prep reminder when time is resolved.

### Notification Decision Guidance

Update `buildAssistantNotificationDecisionGuidanceText()`:

- Add a carve-out for first-session prep automations.
- Tell the assistant not to call `experiment followup due` for first-session prep.
- Tell it to read the experiment and protocol page directly.
- Tell it to skip when the run is inactive, the first session was already logged, the reminder was cancelled or moved, or the saved plan no longer matches the scheduled session.

## Protocol Content

Minimal v1 can ship without protocol content changes because sauna already has first-session guidance, protocol steps, tips, notes, log fields, and stop conditions.

Optional small cleanup:

```yaml
assistantPolicy:
  askBeforeCreatingAutomations: true
  firstSessionPrep:
    default: "auto_when_time_resolved"
    leadMinutes: 15
```

If this metadata is added, keep it optional and protocol-specific. Do not require it across all protocols yet. The global default remains 15 minutes.

## Tests And Scenario Coverage

Primary focused tests:

- Add or update assistant prompt tests proving the onboarding prompt contains first-session prep guidance.
- Add or update assistant prompt tests proving notification decision guidance says first-session prep automations do not call `experiment followup due`.
- Add or update tests proving the prompt requires reading both the saved experiment and Health Commons protocol page before sending.

Smoke scenario coverage:

- Extend `e2e/smoke/scenarios/experiment-apply-onboarding.json` or add a sibling scenario for first-session prep.
- Prove `setupAnswers.first_session_start_at` is recorded.
- Prove `assistantSupport.reminderPolicy=pre_session`.
- Prove `assistantSupport.remindersEnabled=true`.
- Prove `automation save` is invoked with `scheduleKind=at`.
- Prove the automation slug is stable.

Do not add low-level automation/cron tests unless implementation touches automation runtime code.

## Verification Plan

Expected changed areas:

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/test/**`
- optionally `e2e/smoke/scenarios/**`
- optionally `packages/health-commons/content/protocols/**`

Required verification based on current routing:

- Run `pnpm typecheck`.
- Prefer `pnpm test:diff <changed paths>` if it truthfully covers assistant-engine and smoke scenario changes.
- If the diff-aware lane is not truthful, run `pnpm --dir packages/assistant-engine test:coverage` plus `pnpm test:smoke` for scenario integrity.
- If protocol content changes touch Health Commons generated/catalog expectations, run the focused Health Commons/catalog command indicated by existing scripts or the diff-aware lane.
- Run `git diff --check` before commit.

Completion workflow:

- Because this touches health-context assistant behavior and scheduled outbound support, run `security-privacy-review`.
- Because verification includes owner coverage, run `coverage-write` on `gpt-5.4-mini` after implementation is stable.
- Run `task-finish-review` before commit.
- Use `scripts/finish-task agent-docs/exec-plans/active/2026-05-05-first-session-prep-reminders.md "<commit message>" <changed paths>` if a scoped commit is safe.

## Risks And Guardrails

- Avoid adding a new deterministic due kind just to satisfy existing missed-log/weekly-digest guidance.
- Avoid hidden state in assistant runtime; durable scheduled configuration belongs in canonical automation records.
- Avoid scheduling before experiment setup exists.
- Avoid copying the whole Health Commons protocol into automation instructions.
- Avoid pressure or compliance language in scheduled messages.
- Avoid unsafe ambiguity around baseline windows.
- Preserve concurrent edits in active experiment typed-surface and metric-direction lanes.

## Constraints And Assumptions

- Do not add a new `firstSessionPrep` schema object.
- Do not add `experiment followup due --kind first-session-prep`.
- Use existing `assistantSupport` fields and arbitrary onboarding `setupAnswers`.
- Use existing canonical automation one-shot scheduling with stable slugs.
- Preserve unrelated active experiment CLI typed-surface and metric-direction work.
- Keep edits surgical because `packages/assistant-engine/src/assistant/system-prompt.ts` is also listed in the typed-surface plan.

## Key Decisions

- First-session prep is represented by a canonical automation, not a new experiment follow-up primitive.
- The global default lead time is 15 minutes unless a protocol policy later overrides it.
- `askBeforeCreatingAutomations` applies to recurring or post-session support, not this first-session prep reminder when time is resolved.

## State

Done:

- Created this active plan file.
- Registered a coordination-ledger row for the narrow first-session prep reminder lane.
- Updated assistant experiment onboarding guidance for first-session prep reminders.
- Updated notification-decision guidance to carve first-session prep out of `experiment followup due`.
- Added focused assistant prompt tests for onboarding and notification guidance.
- Added smoke-manifest first-session prep `coverageNotes` and verifier validation for optional scenario coverage notes.
- Ran focused prompt, smoke, assistant-engine coverage, and typecheck checks during implementation.
- Ran required coverage-write and security/privacy audit passes; addressed the security findings by making `--slug` explicit and keeping protocol tags non-default.
- Ran final completion review; addressed the findings by excluding first-session prep from default due-check skip behavior, documenting the follow-up `--setup-answer` traceability write, and renaming smoke scenario `assertions` to documentary `coverageNotes`.
- Re-ran focused prompt tests, smoke scenario integrity, assistant-engine coverage, and whitespace checks on the final worktree.
- Used partial staging for the scoped commit so unrelated experiment CLI typed-surface edits in the shared prompt/test files remain unstaged.

Now:

- Implementation complete; active plan closed.

Next:

- None for this lane.

Open questions:

- Protocol metadata was intentionally left unchanged for v1. The prompt-level `askBeforeCreatingAutomations` override avoids requiring a Health Commons schema change for optional `assistantPolicy.firstSessionPrep`.
- `test:diff` currently reaches unrelated experiment CLI typed-surface tests because `packages/assistant-engine` has CLI reverse dependents; scoped assistant-engine coverage is the truthful lane for this diff while that active CLI rewrite is dirty.
- Full `pnpm typecheck` currently reaches unrelated hosted-bundle errors in `packages/runtime-state/src/hosted-bundles.ts` from another active lane after this task's focused prompt and coverage checks have passed.

## Working Set

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- Focused assistant prompt tests under `packages/assistant-engine/test/**`
- Optional smoke scenario under `e2e/smoke/scenarios/**`
- Optional sauna protocol metadata under `packages/health-commons/content/protocols/**`
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
