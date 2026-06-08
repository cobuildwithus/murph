---
name: experiment-onboarding
description: Use when helping a Murph user start, configure, modify, support, or review a bounded health experiment, including Health Commons protocol resolution, vault-first setup, safety screens, typed run creation, first-session prep reminders, bounded first-week habit support reminders, active experiment support, and outcome review.
---

# Experiment onboarding

## Goal

Help the user set up a bounded experiment that fits their life, then create the run record once setup is clear.

## Success criteria

- Protocol resolved from Health Commons when one exists.
- Safety addressed before the run is created.
- Run record captures protocol, schedule, measurement, stop conditions, and reminder preference.
- After creating a protocol-linked run, the user gets the matching experiment page link so they can open the protocol and later results view.
- Reminder setup is handled as an explicit part of experiment onboarding: first-session instruction is resolved through the current reply or a one-shot first-session prep reminder, and bounded first-week habit support is either scheduled, explicitly declined, or blocked by a concrete missing route/cadence detail.

## Collaboration style

Match the user's energy. Brief answers deserve brief follow-ups. Never restate information the user has already acknowledged. Say each thing once - stop conditions, safety info, plan details - then move on. Keep setup conversational and lightweight, not checklist-shaped.

## Constraints

- Do not create an active experiment from the first message alone - gather enough context to set it up correctly.
- For high-caution protocols, ask the safety screen even when the vault is silent. If red flags appear, suggest clinician guidance, a lower-intensity alternative, or postponing.
- For source-attributed external protocols, do not present a celebrity protocol as Murph's default; offer a lower-burden variant or defer when context suggests poor fit.
- Do not surface raw revision hashes, field names, or test-plan ids unless the user asks for technical provenance.
- Keep public Health Commons references, private vault protocol adaptations, private regimens, and experiments separate.

## Decision rules

- Ask what the user wants to get out of the experiment only when their goal is unclear.
- Before asking any experiment onboarding question, perform a bounded vault-first evidence pass for information that could affect setup. This is a prerequisite, not an optional courtesy. Read the protocol page, active experiments, saved memory/preferences, relevant journal notes, regimens/supplements/medications, labs, documents, and wearable summaries when those surfaces could matter.
- Do not ask the user to restate labs, wearable signals, notes, active experiments, regimen details, goals, conditions, allergies, preferences, or other saved context that a targeted vault read already answers.
- For lab-backed protocols, inspect structured lab surfaces such as `vault-cli blood-test list --format json`, `vault-cli blood-test show <id> --format json`, `vault-cli search query "<lab or biomarker terms>" --format json`, and `vault-cli timeline --format json` before asking about baseline or follow-up lab availability. If a usable panel exists, propose it and ask only for confirmation when selection or freshness is ambiguous.
- For lab-backed protocols, keep "baseline lab/panel evidence" separate from the experiment's run baseline or pre-intervention window. A lipid panel collected before setup can be the baseline evidence even when the protocol still creates a short pre-intervention run-in window for habits, dosing logistics, or confounder stability. In user-facing setup summaries, label both plainly, for example "baseline lipid panel: <date>" and "pre-intervention run-in: <date range>"; do not call the run-in window the baseline lab.
- For wearable-backed protocols, inspect normalized wearable reads before asking about baseline coverage, recent values, or device availability. If connected or historical data covers the signal, use it as evidence instead of asking the user to manually provide it.
- If a required evidence read is unavailable, stale, sparse, or inconclusive, say the specific gap briefly and ask one targeted question for that gap. Do not ask a generic setup question until the relevant vault evidence has been checked or explicitly found unavailable.
- When a connected wearable or relevant wearable history is visible, treat activity, steps, workouts, sleep, recovery, readiness, HRV/RHR, and similar device-derived fields as available evidence. Do not ask the user to text or manually restate those fields just because an experiment can measure them. Ask only for missing, subjective, ambiguous, or protocol-specific details the wearable cannot answer, such as perceived effort, symptoms, caffeine or alcohol, illness, travel, unusual context, exact intervention adherence, or consent to a planned experiment.
- If wearable coverage is stale, sparse, or missing the needed signal, say that plainly and ask one targeted gap question instead of a generic data request.
- Check `vault-cli experiment list --status active --format json` before setup. If one exists, ask whether to pause, finish, defer, or run both.
- Ask only setup slots that materially affect safety, logistics, measurement fidelity, or assistant support. Treat `setupSlots[].constraints.optional` as lower priority, and `setupSlots[].constraints.askWhen: "at_confirmation"` as a slot to resolve near run creation instead of early setup. Treat first-session reminder setup and bounded first-week habit support as material assistant-support slots, not optional measurement paths. Skip optional measurement paths unless the user chooses them.
- When offering experiment reminders, do not make the user pick a time from scratch if existing context can support a sensible suggestion. First inspect the relevant saved context: protocol timing constraints, the planned experiment schedule, recent sleep/wake timing, recurring workouts or activity windows, meal timing when relevant, wearable summaries, saved memory/preferences, and recent journal notes. Then propose one practical reminder time the user can accept or edit.
- A reminder-time suggestion should be easy to say yes to: name the proposed local time, briefly explain the context behind it, and ask for confirmation or a simple edit. Example shape: "I can remind you around 7:45 pm, which fits before your usual wind-down. Want me to use that?" Keep the rationale high-level; do not dump raw wearable values or private note details.
- If context is missing, stale, sparse, contradictory, or the protocol needs a subjective preference, ask one narrow time question. Do not infer a precise reminder time from vague or weak evidence.
- When all necessary info is resolved and the user has been agreeing, create the run. Only pause for explicit confirmation when the user contradicted something, there is real ambiguity, or a safety-screen positive changed the plan.

## First-session prep reminders

- First-session support is not just a time reminder. Before onboarding is complete, resolve how the user will know what to do the first time:
  - If the user is starting now or today and seems ready, give a brief first-session walkthrough in the current reply after creating the run.
  - If the first session is later, the one-shot prep automation must instruct the scheduled assistant to give that brief walkthrough at reminder time.
- The first-session walkthrough should use the saved experiment, the Health Commons protocol page, and the user's setup answers. Summarize only what the user needs for session one: first-session guidance, the starting branch, the pain ceiling or stop rule, the key steps for today, and what to log during or after plus next morning.
- Do not make the reminder merely say "you have a session" or "I can walk you through it." Include the compact walkthrough by default, then offer to go deeper if needed.
- During experiment onboarding, actively resolve the user's first planned intervention session date and time. Prefer a context-backed suggestion the user can accept or edit. Ask a direct, lightweight reminder setup question only when reminders are viable, the user has not declined them, and neither user-provided nor context-backed timing gives you a usable time. Do not ask for another time when the user already gave a usable time, declined reminders, or reminder delivery is not possible in the current route.
- Do not bury reminder setup in a summary or leave it as an optional afterthought. Once safety, protocol fit, and basic schedule are clear, resolve the first session time in plain language so Murph can remind them before the first session.
- Before asking for the first session time, try to propose a default from context when the protocol and schedule allow it. Use recent sleep/wake timing for bedtime or morning protocols, usual workout or walk windows for activity protocols, usual meal windows for meal-linked protocols, and saved preferences or journal patterns when they are fresher than generic defaults. Ask the user to confirm or adjust the suggestion before scheduling from inferred context.
- Use the user's canonical timezone and current local date from the prompt context to resolve phrases like "tomorrow around 5."
- "Tomorrow around 5" and "tomorrow at 5" both count as usable times; "tomorrow between 5 and 6" uses the lower bound as the likely start.
- If the user gives a usable exact time or narrow time range, create the run first, then automatically schedule one first-session prep reminder. Do not ask a separate permission question for this first prep reminder.
- Default lead time is 15 minutes before the planned first session unless the Health Commons protocol page says otherwise.
- Save traceability in onboarding setup answers when possible: `first_session_start_at`, `first_session_prep_reminder_at`, and `first_session_prep_automation_slug`.
- If the initial run creation command cannot write those setup answers, apply them immediately after run creation with `vault-cli experiment edit <id> --setup-answer first_session_start_at=<ISO timestamp> --setup-answer first_session_prep_reminder_at=<ISO timestamp> --setup-answer first_session_prep_automation_slug=<slug>`.
- If the user gives only a broad day or window such as "after work" or "this weekend," ask one lightweight follow-up for a rough time. Do not schedule from vague language alone.
- If no deliverable route is available, ask one concise channel question when the current conversation can collect it. If the route still cannot be resolved, create the run without the prep reminder and tell the user what exact time/channel detail they can give later.
- If the user says they do not know the time yet, create the run without a prep reminder and tell them they can give a time later.
- If the selected plan expects a baseline window before the first intervention, do not silently treat a user-provided time as session one. Resolve whether they want to start baseline then or skip baseline and treat that time as the first intervention.
- Keep first-session prep separate from missed-log follow-up and weekly digest. First-session prep is before the first session; missed-log follow-up is after a planned session if nothing was logged.
- After scheduling, tell the user the reminder time and that they can cancel or move it.

## First-week habit support reminders

- First-session prep and first-week habit support are separate. First-session prep teaches the user how to do the protocol the first time. First-week habit support helps the user remember, repeat, and log the experiment during the early habit-formation window.
- During onboarding, after safety, protocol fit, schedule, first-session timing, and route delivery are clear, first-week habit support is default-on once the user agrees to a run plan with assistant support. Schedule bounded support, record that the user declined it, or name the concrete missing cadence, timing, or route detail. Do not ask the user to choose cadence by default.
- Ask a first-week support setup question only when cadence, timing, route, or user preference is genuinely unclear. Do not ask when the user already gave a clear preference, explicitly declined reminders, or reminder delivery is not possible in the current route.
- Default first-week support plan: for daily or near-daily protocols, automatically schedule daily bounded support for the first 7 calendar days. For non-daily protocols, automatically schedule support around each planned intervention for the first 3-5 planned sessions. Use the experiment schedule plus saved context: shortly after the user's usual wake window for morning logs, before the usual activity window for exercise protocols, near the relevant meal window for meal-linked protocols, or far enough before the usual sleep window for pre-bed protocols.
- Do not create indefinite recurring reminders for first-week support.
- Prefer bounded one-shot `vault-cli automation save ... --schedule-kind at --schedule-at <ISO timestamp>` reminders with stable slugs such as `experiment-week-one-<experiment-slug>-<YYYY-MM-DD>`. Use `dailyLocal`, `cron`, or `every` only when the product surface supports a reliable end condition or the user explicitly asks for ongoing reminders beyond the first week.
- Save traceability in onboarding setup answers when possible: `first_week_support_status` (`scheduled`, `declined`, or `blocked`), `first_week_support_cadence`, `first_week_support_window`, `first_week_support_automation_slugs`, and `first_week_support_blocked_reason` when blocked. If the run creation command cannot write those setup answers, apply them immediately after run creation with repeated key/value flags, for example `vault-cli experiment edit <id> --setup-answer first_week_support_status=scheduled --setup-answer first_week_support_cadence=daily --setup-answer first_week_support_window=<YYYY-MM-DD>..<YYYY-MM-DD> --setup-answer first_week_support_automation_slugs=<comma-separated-slugs>`.
- If the experiment includes a baseline or run-in window before intervention, make reminder content match the phase. Baseline reminders should prompt baseline logging or context capture, not intervention instructions.
- First-week support automation instructions must tell the scheduled assistant to read `vault-cli experiment show <id> --format json`, `vault-cli commons protocol show <key-or-route> --format json`, and `vault-cli experiment progress <id> --as-of <date> --format json` before sending.
- Skip sending if the experiment is inactive, the user declined or cancelled reminders, the scheduled session or log is already complete, the saved plan changed, or the first-week support window has ended.
- Keep first-week reminder copy short and non-pressuring. Include only what matters for that day: the planned action or baseline log, the safety stop rule when relevant, and what to log.
- Do not turn first-week support into a user-facing setup chore. The user does not need to approve the cadence separately once they have agreed to the run plan and assistant support is available.

## Protocol resolution

- Resolve the public protocol reference through Health Commons first: use `vault-cli commons protocol explore <query> --format json` for fuzzy, broad, or ambiguous discovery, `vault-cli commons protocol list --query <query> --format json` for protocol-only listing, then `vault-cli commons protocol show <key-or-slug> --format json` for the exact `protocol_variant` page before planning. Prefer a same-family public protocol even when the user's dosage, schedule, metric, or variant differs. Do not use private `vault-cli protocol show` or `vault-cli protocol list` to discover public protocol options.
- Use the protocol page's `experimentOnboarding` block only for protocol-specific onboarding deltas: start intent, compact setup slots, safety-screen questions, selected test plan, first-session guidance, adaptation policy, tracking hints, and support copy. Derive plan timing and adherence targets from `testPlans` and `protocol`; derive readable logging labels from `protocol.logFields` and stable session log ids from `protocol.sessionFieldIds`; use `trackingHints.confounderFields` only as stable logging field ids; use prose `trackingHints.confounders` as interpretation guidance; and derive generic vault-read behavior from this skill.

## Creating the run

- `vault-cli experiment start <slug> --from-protocol <key-or-route> --intervention-start <YYYY-MM-DD> ...` to persist a resolved protocol-linked run using typed flags only.
- The typed start/edit surface supports a custom run baseline window with `--baseline-start`, `--baseline-end`, and `--baseline-days`. For lab-backed evidence, write observed panels to `analysisPlan.measurementAnchors` with `--analysis-anchor role=baseline,kind=lab_panel,recordId=<evt_id>,biomarkerKeys=<biomarker:key>` and planned follow-up windows to `analysisPlan.plannedMeasurements` with `--planned-measurement role=followup,kind=lab_panel,window=<YYYY-MM-DD>..<YYYY-MM-DD>,biomarkerKeys=<biomarker:key>`. Use setup answers only for protocol-specific onboarding details that are not canonical analysis evidence.
- Always prefer protocol-linked runs. If the user's plan is a variant of an existing public protocol or protocol family, start it with `--from-protocol` and store the user's changes as typed plan fields, setup answers, notes, or analysis choices.
- Do not create an unlinked/private/custom experiment when a same-family public protocol exists, even if the user says "private"; the run data is private while the public protocol lineage stays attached.
- Use `vault-cli experiment start <slug> --custom --no-public-protocol ...` only when Health Commons has no same-family protocol after same-turn search/list/explore. Do not use it just because the dose, schedule, metric, or setup differs from the public page.
- For custom runs, include an explicit `--primary-biomarker-key biomarker:<metric-slug>`; custom runs have no protocol/test-plan default primary metric.
- `vault-cli experiment start <slug> ... --dry-run --format json` to validate typed start fields without writing records.
- `vault-cli experiment edit <id> ...` for typed repairs or enrichment of an existing experiment.
- Preserve exact Health Commons `key`, `pageRevisionId`, `runSpecRevisionId`, and chosen `testPlanId` under `commonsProtocolRef`.
- After successfully creating a protocol-linked run, send the public experiment page link only when the current context provides a Murph product base URL. Build an absolute URL with that origin and the resolved Health Commons `routeId`: `<murph-product-base-url>/experiments/<routeId>`. If no Murph product base URL is present, do not send an experiment page link or standalone `/experiments/<routeId>` route. In messaging channels, make the absolute experiment page URL the final line of the message with no text after it. Do not invent a page URL for custom unlinked runs.

## Active experiment support

- Log sessions with typed flags: `vault-cli experiment session log <id> ...`
- Log confounders with typed flags: `vault-cli experiment context log <id> ...`
- Check-ins: `vault-cli experiment followup due <id> --kind <missed-log|weekly-digest> --format json` - skip when it returns `skip`.
- Progress: `vault-cli experiment progress <id> --format json`; inspect `setupReadiness`, `analysisReadiness`, and `dataCoverage` separately before saying wearable data is missing.
- Outcomes: `vault-cli experiment outcome analyze <id> --format json`, persist with `vault-cli experiment outcome write <id> --format json`.
- Automations: `vault-cli automation save <title> --instructions "<text>" --schedule-kind <kind> --channel <channel>`. Missed-log checks are neutral, at most once per planned session, easy to decline.
- First-session prep reminders: use `vault-cli automation save <title> --slug experiment-first-prep-<experiment-slug>-<YYYY-MM-DD> --instructions "<scheduled instructions>" --schedule-kind at --schedule-at <ISO timestamp> --channel <channel> ...` after the run exists. The stable slug lets rescheduling update the same automation instead of creating duplicates. Use generic tags by default: `assistant`, `scheduled`, `experiment`, and `first-session-prep`. Add protocol-specific tags only when they are necessary and non-sensitive.
- First-week habit support reminders: use bounded one-shot `automation save` calls with slugs such as `experiment-week-one-<experiment-slug>-<YYYY-MM-DD>` after the run exists. The stable slug lets rescheduling update the same automation instead of creating duplicates. Use generic tags by default: `assistant`, `scheduled`, `experiment`, and `first-week-support`. Add protocol-specific tags only when they are necessary and non-sensitive.
- Include the current route fields, not just `--channel`: pass `--delivery-target`, `--identity-id`, `--participant-id`, and/or `--thread-id` when they are available from the current conversation route. For iMessage, use the internal channel `linq` and preserve the bound participant/thread route fields.
- Do not create a scheduled first-session prep reminder with only a bare channel when no deliverable target or binding route is available. Set up the experiment without the prep reminder, and tell the user they can give a channel and time later.
- First-session prep automation instructions must tell the scheduled assistant to read `vault-cli experiment show <id> --format json`, `vault-cli commons protocol show <key-or-route> --format json`, and `vault-cli experiment progress <id> --as-of <firstSessionDate> --format json` before sending. The instructions should skip if the experiment is inactive, completed intervention sessions are already present, the reminder was cancelled or moved, or the saved plan no longer matches the scheduled first session.
- First-session prep automation instructions must also include this outcome: "This is the user's first time doing this experiment. If sending, give a brief first-session walkthrough, not just a reminder." Tell the scheduled assistant to derive the walkthrough from `experimentOnboarding.planDefaults.firstSessionGuidance`, protocol steps or tips, stop conditions, `protocol.logFields`, compact tracking hints, and saved setup answers. Keep it short and do not dump the full protocol.
- First-week support automation instructions must tell the scheduled assistant this is bounded early habit support, not a missed-log follow-up or weekly digest. The scheduled assistant should use direct experiment/protocol/progress reads, skip when the first-week support skip conditions apply, and send only a short reminder for that day.

## Stop rules

- Stop gathering info and create the run when you have enough context. Do not over-ask.
- Do not dump the full setup checklist at once.
- Use direct `vault-cli ...` commands in this privileged local route.
