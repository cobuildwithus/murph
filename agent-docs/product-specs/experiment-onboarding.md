# Experiment Onboarding

Last verified: 2026-05-08

## Current State

Murph can already surface public experiment protocols and can already create private experiment runs in the vault, but it needs a durable contract for the step in between: helping a user explore whether and how to start a protocol without silently converting the first message into an active run.

Because Murph's downstream outcome-card and contribution loop depends on exact protocol lineage, onboarding must preserve the runnable protocol reference before any run exists.

## Product Boundary

Experiment onboarding is planning by default.

- A request to start, run, explore, or set up a protocol should begin as a planning conversation, not an immediate write.
- Health Commons protocol pages may carry an `experimentOnboarding` block that defines the start intent, context review hints, safety screen, setup slots, plan defaults, logging fields, and assistant-support policy for that protocol.
- The onboarding block is public protocol metadata. It does not itself create a private run, reminder, or user state.
- Private run creation still happens only in the user vault after setup is resolved and the user has been agreeing. A separate "confirm" step is only needed when there is ambiguity or the user contradicted something.
- After a protocol-linked run is created, the assistant should send the matching experiment page link so the user can reopen the protocol and later results view.
- The richer downstream loop is: onboarding plan -> private run -> outcome card -> optional sharing or contribution. Onboarding owns only the planning step.
- Safety-screen positives or uncertainty are guardrails for unsupervised setup, not diagnoses.
- Assistant follow-ups should never be created before the experiment is set up. After setup, follow-ups included in the agreed plan may default on with a clear opt-out, and should use neutral language that records what happened rather than implying failure.

## Contract Shape

The onboarding contract lives on the protocol page, not in assistant runtime state.

It may include:

- `startIntent` for the plain-language prompt or summary used to begin the flow
- `contextReview` for vault checks and read hints that should be reviewed before repeated setup questions
- `safetyScreen` for compact red-flag questions, dispositions, and stop-policy inheritance
- `setupSlots` for the minimum questions that change safety, logistics, measurement fidelity, or assistant support
- `planDefaults` for baseline/intervention length, adherence targets, and the linked test plan
- `logging` for session fields and confounders worth tracking
- `assistantPolicy` for question pacing, reminder defaults, and confirmation behavior

`contextReview.vaultChecks[].readHints` are command hints, not automations. They help the assistant choose the right existing read surfaces for a protocol, but the assistant still owns when to run them and should verify exact CLI shape when a hint is abbreviated or stale.

## Start Intents, Not Silent Starts

- A hosted `Run Experiment` click should create a short-lived start intent, not an active experiment.
- The assistant should resolve that intent into a protocol-aware onboarding conversation in the user's configured channel.
- Public prompt copy may say something like "Hey Murph, I want to explore doing Norwegian 4x4 intervals," but the durable contract is the structured onboarding block plus the exact protocol revision, not a prefilled sentence.

## Revision-Preserving Handoff

Before Murph writes a private run, it should already know the exact Health Commons page it is using.

- Read the protocol page before planning.
- Preserve `commonsProtocolRef.key`, `commonsProtocolRef.pageRevisionId`, `commonsProtocolRef.runSpecRevisionId`, and the selected `testPlanId` in the richer private run record. Store a private `protocolRef` only when the run uses a saved private adaptation.
- Treat `runSpecRevisionId` as the hash of the runnable contract: protocol dose, safety, test plans, and experiment onboarding. Copy edits or narrative body changes may change `pageRevisionId` without changing `runSpecRevisionId`.
- The private run should store user choices and assistant support policy separately from public protocol copy.
- For lab-backed runs, store and explain baseline evidence separately from the run baseline or pre-intervention window. A pre-existing lab panel may be the baseline evidence even when the runnable protocol has a prospective run-in window for adherence, logistics, or confounder control.
- Completed outcome cards, shares, and community contributions must remain traceable back to this exact runnable contract.

## Reminder Policy

- Reminders are experiment support that belong in the confirmed plan, not hidden compliance machinery.
- Once a user agrees to a run plan with assistant support, missed-log checks may be default-on and opt-out.
- Scheduled checks should call deterministic product logic, such as `vault-cli experiment followup due <id> --kind missed-log --format json`, before deciding whether an outbound message is due.
- Missed-log follow-up should be neutral, at most once per planned session, and easy to decline.
- Weekly summaries are preferred over daily coaching by default.

## Onboarding Is Structured Planning, Not A Transcript

The assistant may sound conversational, but the durable product contract is the structured plan it produces:

- start intent
- reviewed context
- safety outcome
- selected setup slots
- final run plan
- optional reminder policy

Chat is the interface. The onboarding block and the saved run are the source of truth.

## Flow Rules

- Check for an already active experiment before starting another meaningful one by default.
- When a user logs an intervention session, route it to an experiment only when there is exactly one active matching run, the session date is inside that run's intervention window, and the intervention modality matches the run plan or protocol key. If there are multiple candidates, do not silently choose; ask for an explicit experiment slug or id, or save with an explicit skip-experiment-link choice.
- Ask what the user wants to get out of the experiment unless the goal is already clear.
- Review relevant saved context and wearable availability before asking setup questions that Murph can already answer from the vault.
- Before asking any experiment onboarding question, run a bounded vault-first evidence pass across the data surfaces that could affect setup: active experiments, saved memory/preferences, relevant journal notes, regimens/supplements/medications, labs, documents, wearable summaries, and the protocol onboarding `contextReview.vaultChecks[].readHints`. Treat `ask_if_unknown` slots as unknown only after that pass. If evidence is present, use it or ask only for confirmation when selection, freshness, or applicability is ambiguous. If evidence is unavailable, stale, sparse, or inconclusive, name the specific gap and ask one targeted question for that gap.
- For lab-backed protocols, setup summaries and repair replies must name the baseline lab/panel date separately from the run baseline or pre-intervention window. Avoid a bare "baseline: <date range>" line when an earlier lab panel is the actual biomarker baseline; use labels such as "baseline lipid panel" and "pre-intervention run-in" so the user can tell which fact came from uploaded results and which fact came from protocol scheduling defaults. Persist the observed panel as `analysisPlan.measurementAnchors[]`; persist future lab timing as `analysisPlan.plannedMeasurements[]`. Do not rely on freeform setup notes for canonical analysis evidence.
- Ask the safety screen even when the vault is silent for high-caution protocols.
- Keep setup lightweight and gradual: ask only the slots that materially affect safety, logistics, measurement fidelity, or assistant support; ask at most two questions per response; and continue across turns until goal, safety, logistics, measurement, logging, stop-condition, and reminder coverage is complete.
- When all setup slots are resolved and the user has been agreeing throughout, create the run directly — no separate confirmation step required. Only pause for explicit confirmation when the user contradicted something, when there is ambiguity about dates/dose/schedule, or when a safety-screen positive changed the plan.
- After successfully creating a protocol-linked run, send the resolved Health Commons protocol page link only when the current Murph product base URL is injected. Build an absolute URL from that origin and `/experiments/<routeId>`. If no Murph product base URL is present, do not send an experiment page link or standalone `/experiments/<routeId>` route. In messaging channels, make the absolute experiment page URL the final line of the message with no text after it. Do not fabricate a protocol page link for custom unlinked runs.
- When you do summarize before creating, keep it to new information only — never repeat stop conditions, safety info, or details already discussed. The summary should be crisp enough that a later outcome card or share artifact can clearly point back to what was actually run.
- Keep any pre-creation summary human-readable. Raw revision hashes, internal field names, and selected test-plan identifiers are lineage data for the saved run record, not default onboarding copy; mention them only when the user asks for technical provenance.

## Success Criteria

1. A protocol page can declare a machine-readable onboarding block without creating private user state.
2. Assistants can use that block to review context, ask the right safety and setup questions, and summarize the plan consistently.
3. `runSpecRevisionId` changes when onboarding semantics that affect a runnable protocol change.
4. When setup is unambiguous and the user has been agreeing, Murph creates the experiment without requiring a formal confirmation step; any assistant follow-ups included in that plan must remain easy to opt out of.
5. High-caution protocols can steer users toward clinician guidance, lower-intensity alternatives, or postponement without pretending that Murph diagnosed them.
6. Protocol-specific read hints stay on the public protocol page so assistants do not need a second protocol-by-protocol prompt fork to know which CLI reads matter.
7. Protocol-linked run handoff includes the matching experiment page link so the user can return to the protocol and results surface.
8. Completed runs remain traceable to exact protocol revisions so outcome cards, comparisons, and later cohort summaries mean the same thing.
