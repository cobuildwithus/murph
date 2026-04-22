# Experiment Onboarding

Last verified: 2026-04-22

## Current State

Murph can already surface public experiment protocols and can already create private experiment runs in the vault, but it needs a durable contract for the step in between: helping a user explore whether and how to start a protocol without silently converting the first message into an active run.

## Product Boundary

Experiment onboarding is planning by default.

- A request to start, run, explore, or set up a protocol should begin as a planning conversation, not an immediate write.
- Health Commons protocol pages may carry an `experimentOnboarding` block that defines the start intent, context review hints, safety screen, setup slots, plan defaults, logging fields, and assistant-support policy for that protocol.
- The onboarding block is public protocol metadata. It does not itself create a private run, reminder, or user state.
- Private run creation still happens only in the user vault after explicit confirmation.
- Safety-screen positives or uncertainty are guardrails for unsupervised setup, not diagnoses.
- Reminder automations are opt-in and should use neutral language that records what happened rather than implying failure.

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
- Preserve `protocolRef.key`, `protocolRef.pageRevisionId`, `protocolRef.runSpecRevisionId`, and the selected `testPlanId` in the richer private run record.
- Treat `runSpecRevisionId` as the hash of the runnable contract: protocol dose, safety, test plans, and experiment onboarding. Copy edits or narrative body changes may change `pageRevisionId` without changing `runSpecRevisionId`.
- The private run should store user choices and assistant support policy separately from public protocol copy.

## Reminder Policy

- Reminders are opt-in support, not hidden compliance machinery.
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
- Review relevant saved context and wearable availability before asking setup questions that Murph can already answer from the vault.
- Ask the safety screen even when the vault is silent for high-caution protocols.
- Keep setup lightweight: ask only the slots that materially affect safety, logistics, measurement fidelity, or assistant support, and prefer one or two questions per turn.
- Before any write, summarize the exact protocol reference, dates, schedule, modality or dose, logging expectations, stop conditions, and reminder policy.
- Create the private run only after explicit confirmation.

## Success Criteria

1. A protocol page can declare a machine-readable onboarding block without creating private user state.
2. Assistants can use that block to review context, ask the right safety and setup questions, and summarize the plan consistently.
3. `runSpecRevisionId` changes when onboarding semantics that affect a runnable protocol change.
4. A user must explicitly confirm before Murph creates an active experiment or reminder automation.
5. High-caution protocols can steer users toward clinician guidance, lower-intensity alternatives, or postponement without pretending that Murph diagnosed them.
6. Protocol-specific read hints stay on the public protocol page so assistants do not need a second protocol-by-protocol prompt fork to know which CLI reads matter.
