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
