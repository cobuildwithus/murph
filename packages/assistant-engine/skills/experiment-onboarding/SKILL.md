---
name: experiment-onboarding
description: Use when helping a Murph user start, configure, modify, support, or review a bounded health experiment, including Health Commons protocol resolution, vault-first setup, safety screens, typed run creation, first-session prep reminders, active experiment support, and outcome review.
---

# Experiment onboarding

## Goal

Help the user set up a bounded experiment that fits their life, then create the run record once setup is clear.

## Success criteria

- Protocol resolved from Health Commons when one exists.
- Safety addressed before the run is created.
- Run record captures protocol, schedule, measurement, stop conditions, and reminder preference.
- After creating a protocol-linked run, the user gets the matching experiment page link so they can open the protocol and later results view.
- When the first intervention session time is resolved, a one-shot first-session prep reminder is scheduled as part of the setup.

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
- Before asking any experiment onboarding question, perform a bounded vault-first evidence pass for information that could affect setup. This is a prerequisite, not an optional courtesy. Read the protocol page, active experiments, saved memory/preferences, relevant journal notes, regimens/supplements/medications, labs, documents, wearable summaries, and the protocol onboarding block `contextReview.vaultChecks[].readHints` when those surfaces could matter.
- Treat `ask_if_unknown` setup slots as unknown only after that vault-first pass. Do not ask the user to restate labs, wearable signals, notes, active experiments, regimen details, goals, conditions, allergies, preferences, or other saved context that a targeted vault read already answers.
- For lab-backed protocols, inspect structured lab surfaces such as `vault-cli blood-test list --format json`, `vault-cli blood-test show <id> --format json`, `vault-cli search query "<lab or biomarker terms>" --format json`, and `vault-cli timeline --format json` before asking about baseline or follow-up lab availability. If a usable panel exists, propose it and ask only for confirmation when selection or freshness is ambiguous.
- For lab-backed protocols, keep "baseline lab/panel evidence" separate from the experiment's run baseline or pre-intervention window. A lipid panel collected before setup can be the baseline evidence even when the protocol still creates a short pre-intervention run-in window for habits, dosing logistics, or confounder stability. In user-facing setup summaries, label both plainly, for example "baseline lipid panel: <date>" and "pre-intervention run-in: <date range>"; do not call the run-in window the baseline lab.
- For wearable-backed protocols, inspect normalized wearable reads before asking about baseline coverage, recent values, or device availability. If connected or historical data covers the signal, use it as evidence instead of asking the user to manually provide it.
- If a required evidence read is unavailable, stale, sparse, or inconclusive, say the specific gap briefly and ask one targeted question for that gap. Do not ask a generic setup question until the relevant vault evidence has been checked or explicitly found unavailable.
- When a connected wearable or relevant wearable history is visible, treat activity, steps, workouts, sleep, recovery, readiness, HRV/RHR, and similar device-derived fields as available evidence. Do not ask the user to text or manually restate those fields just because an experiment can measure them. Ask only for missing, subjective, ambiguous, or protocol-specific details the wearable cannot answer, such as perceived effort, symptoms, caffeine or alcohol, illness, travel, unusual context, exact intervention adherence, or consent to a planned experiment.
- If wearable coverage is stale, sparse, or missing the needed signal, say that plainly and ask one targeted gap question instead of a generic data request.
- Check `vault-cli experiment list --status active --format json` before setup. If one exists, ask whether to pause, finish, defer, or run both.
- Ask only setup slots that materially affect safety, logistics, measurement fidelity, or assistant support. Skip optional measurement paths unless the user chooses them.
- When all necessary info is resolved and the user has been agreeing, create the run. Only pause for explicit confirmation when the user contradicted something, there is real ambiguity, or a safety-screen positive changed the plan.

## First-session prep reminders

- During experiment onboarding, try to resolve the user's first planned intervention session date and time.
- Use the user's canonical timezone and current local date from the prompt context to resolve phrases like "tomorrow around 5."
- "Tomorrow around 5" and "tomorrow at 5" both count as usable times; "tomorrow between 5 and 6" uses the lower bound as the likely start.
- If the user gives a usable exact time or narrow time range, create the run first, then automatically schedule one first-session prep reminder. Do not ask a separate permission question for this first prep reminder.
- Default lead time is 15 minutes before the planned first session unless the Health Commons protocol page says otherwise.
- Save traceability in onboarding setup answers when possible: `first_session_start_at`, `first_session_prep_reminder_at`, and `first_session_prep_automation_slug`.
- If the initial run creation command cannot write those setup answers, apply them immediately after run creation with `vault-cli experiment edit <id> --setup-answer first_session_start_at=<ISO timestamp> --setup-answer first_session_prep_reminder_at=<ISO timestamp> --setup-answer first_session_prep_automation_slug=<slug>`.
- If the user gives only a broad day or window such as "after work" or "this weekend," ask one lightweight follow-up for a rough time. Do not schedule from vague language alone.
- If the user says they do not know the time yet, create the run without a prep reminder and tell them they can give a time later.
- If the selected plan expects a baseline window before the first intervention, do not silently treat a user-provided time as session one. Resolve whether they want to start baseline then or skip baseline and treat that time as the first intervention.
- Keep first-session prep separate from missed-log follow-up and weekly digest. First-session prep is before the first session; missed-log follow-up is after a planned session if nothing was logged.
- After scheduling, tell the user the reminder time and that they can cancel or move it.

## Protocol resolution

- Resolve the public protocol reference through Health Commons first: use `vault-cli commons search "<query>" --format json` or `vault-cli commons protocol list --format json` for fuzzy discovery, `vault-cli commons protocol explore <query> --format json` when the request is broad or ambiguous, then `vault-cli commons protocol show <key-or-slug> --format json` for the exact `protocol_variant` page before planning. Prefer a same-family public protocol even when the user's dosage, schedule, metric, or variant differs. Do not use private `vault-cli protocol show` or `vault-cli protocol list` to discover public protocol options.
- Use the protocol page's `experimentOnboarding` block for setup slots, safety screen, plan defaults, logging fields, and read hints. Fall back to `safety`, `testPlans`, `protocol`, and `claims` fields when no onboarding block exists.

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
- Include the current route fields, not just `--channel`: pass `--delivery-target`, `--identity-id`, `--participant-id`, and/or `--thread-id` when they are available from the current conversation route. For iMessage, use the internal channel `linq` and preserve the bound participant/thread route fields.
- Do not create a scheduled first-session prep reminder with only a bare channel when no deliverable target or binding route is available. Set up the experiment without the prep reminder, and tell the user they can give a channel and time later.
- First-session prep automation instructions must tell the scheduled assistant to read `vault-cli experiment show <id> --format json`, `vault-cli commons protocol show <key-or-route> --format json`, and `vault-cli experiment progress <id> --as-of <firstSessionDate> --format json` before sending. The instructions should skip if the experiment is inactive, completed intervention sessions are already present, the reminder was cancelled or moved, or the saved plan no longer matches the scheduled first session.
- Protocol `assistantPolicy.askBeforeCreatingAutomations` applies to recurring or post-session support, not to this automatic first-session prep reminder when the first session time is resolved.

## Stop rules

- Stop gathering info and create the run when you have enough context. Do not over-ask.
- Do not dump the full setup checklist at once.
- Use direct `vault-cli ...` commands in this privileged local route.
