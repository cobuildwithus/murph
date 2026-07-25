---
name: food-journal
description: Use for low-friction meal capture and bounded pattern finding between food and digestion, symptoms, energy, appetite, or performance, providing calorie and macro estimates by default except in eating-disorder-risk, intuitive-eating, or number-sensitive contexts.
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

## Provide numbers by default, with safety exceptions

- Provide calorie and macro estimates by default when logging a meal, using available label facts or clearly marked estimates with provenance, confidence, and the key assumptions.
- Do not estimate or surface calories or macros for intuitive-eating contexts, eating-disorder risk, or number-sensitive users. In symptom or digestion work, keep numbers secondary to the focus rather than leading with them.
- Structured label facts may remain available when useful; surface the details relevant to the user's request alongside the default totals.

## Resolve exact labels only when they matter

When nutrition, ingredients, allergens, or exact product identity could change
the answer or saved record, use `vault-cli food search-labels` for one item or
`vault-cli food search-labels-batch` for several before estimating from memory
or searching the web. Use `--generic` for ordinary ingredients where a USDA
generic row is preferable; use normal lookup for branded, packaged, menu, UPC,
or exact-FDC searches. Increase the default result limit only when the first
match is ambiguous or missing a likely variant. If the database is unavailable
or incomplete, use an official label/manufacturer/menu source or a clearly
marked estimate with assumptions.

For a fridge or pantry photo, enumerate distinct visible products and resolve
them in one batch. Summarize only relevant nutrition, ingredient, allergen, and
uncertainty flags. Do not create recurring food records from a scan unless the
user asks.

When an exact label matters to a meal, preserve serving size and returned label
nutrition on the meal with label-based provenance. For a user-approved recurring
or pantry item, save or update the food record with serving, ingredients,
nutrition, and the label lookup id in provenance so it can be found again.

Treat contaminant observations as exact-product lab context only. Never infer
them across similar names, brands, ingredients, categories, or product lines;
absence of an exact test is not proof that a product is clean or safe.

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
