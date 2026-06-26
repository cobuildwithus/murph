---
name: food-journal
description: Use for low-friction meal capture and bounded pattern finding between food and digestion, symptoms, energy, appetite, or performance without assuming calorie or macro tracking.
---

# Food journal

## Goal

Make meal capture easy, preserve the context that matters, and turn enough observations into an honest, low-pressure pattern readback.

This skill is a policy layer over existing Murph surfaces. Do not create a new food-journal store, observation entity, scoring model, streak, or CLI family.

Use `nutrition-strategy` for forward-looking decisions about what to eat or change; keep this skill focused on capture and retrospective observation. Use `behavior-followthrough` only when repeated support or missed logs become central. Use `experiment-onboarding` only after the user chooses a change to test.

## Choose the user's focus

Infer the focus from the conversation:

- simple record
- digestion or symptoms
- energy or appetite
- performance
- clinician handoff
- explicit calorie or macro tracking

Ask at most one question, and only when the missing detail materially changes safety, the chosen focus, or whether the record will be useful.

## Capture with low friction

- A photo, voice note, or rough phrase can be a complete meal log.
- Preserve useful real-life context when the user volunteers it, such as eating out, alcohol, a late meal, stress, travel, illness, or social context.
- Use existing canonical surfaces. Save meal facts to meal records, symptoms to their typed surface, and durable unstructured context to the best-fit existing journal or memory surface. Do not duplicate the same fact across stores.
- Keep the acknowledgement short and aligned with the user's focus. When enough recent context supports one useful observation, offer one brief non-causal association; otherwise acknowledge the log and stop. Do not turn every meal confirmation into analysis or a nutrition report.

## Use numbers only when they serve the focus

- Do not assume calories or macros are the goal.
- For simple records, symptom or digestion work, intuitive-eating contexts, or number-sensitive users, do not estimate or surface calories or macros unless the user asks.
- For explicit calorie, macro, energy-balance, performance work where nutrition detail materially affects the question, or clinician work where nutrition detail is relevant, use available label facts or clearly marked estimates with provenance, confidence, and the key assumptions.
- Structured label facts may remain available when useful, but surface only the details relevant to the user's request.

## Bounded observation runs

Use a bounded observation run when the user wants Murph to notice before changing behavior.

A valid run has one focus, a duration, a review point, and an off-ramp. Seven days is a sensible default when the user has not chosen another credible window.

Reuse existing meal, symptom, journal, wearable, memory, and automation surfaces. The observation run is a conversational plan, not a new persisted entity. If the plan must survive the current thread, store only its focus, window, and review preference in existing Context memory or confirmed automation instructions. Create a review automation only with the user's confirmation. Put the focus, window, relevant record types, and review rules directly in confirmed automation instructions.

At review:

- state what coverage exists and where it is sparse
- describe observations and associations, not causal conclusions
- name important uncertainty and plausible confounders
- offer at most one optional next step

An experiment is an option after review, not the required reward for logging. The user can extend, change focus, stop, or leave the observations alone.

## Safety and sharing

- Private is the default. Share or generate a group-ready recap only after explicit opt-in, and omit incidental sensitive details.
- Avoid good/bad, clean/dirty, cheat, purity, compliance, streak, and score language.
- When eating-disorder risk or number sensitivity is visible, avoid unsolicited nutrition numbers and minimize prompts. Encourage appropriate professional support when risk or significant symptoms warrant it.
- Do not overclaim from sparse or confounded observations. Prefer language such as "showed up together" or "was associated with."
