---
name: food-journal
description: Use for low-friction meal capture, connected meal and nutrient questions, and bounded pattern finding between food and digestion, symptoms, energy, appetite, or performance, providing calorie and macro estimates by default except in eating-disorder-risk, intuitive-eating, or number-sensitive contexts.
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

For a connected carbohydrate-record question, use one bounded day or
short-range read:
`vault-cli measurement entry list --metric carbohydrates --from <date> --to <date> --limit 50 --format json`.
Returned grams are partial intake evidence. Do not infer food identity, a
complete meal, total daily carbohydrate, or eaten calories from them. No
returned entry means unavailable, not zero.

For a connected or saved-meal vitamin, mineral, or water question, use one
bounded day or short-range read:
`vault-cli meal nutrients --from <date> --to <date> --format json`.
The response lists every supported nutrient field. A `null` total with zero
contributing meals means unavailable, not zero. A `contributingMealCount` below
the enclosing `mealCount` means the total is partial across the selected stored
meals; do not extrapolate the missing meals. Equal counts mean every selected
stored meal record supplied that field, not that every meal eaten that day was
logged. The aggregate may combine connected and manually saved meals. Do not
attribute its totals or coverage to one provider or claim that provider was
complete unless separate provider-specific evidence establishes that.

Treat this as a bounded sum of stored meal fields, not a copy of the source
app's daily dashboard. Source-app targets, daily percentages, and completeness
claims are not imported. When asked what is "low," report the observed total and
coverage first. Do not call an intake low, adequate, deficient, or excessive
unless a trustworthy target applies to this member and the stored unit and
nutrient form are compatible with it; name the target basis and remaining
uncertainty. If the member asks for a reference comparison, use a current
authoritative source rather than a remembered target and obtain the age, sex,
and pregnancy or lactation context needed for that source. Do not directly
compare provider fields for folic acid, vitamin A, vitamin E, or niacin to DFE,
RAE, alpha-tocopherol, or niacin-equivalent targets unless the imported form and
conversion basis are known. One day of food records does not diagnose a
deficiency. Use
`nutrition-strategy` for food-first suggestions and
`micronutrients-supplements` for labs, supplement dosing, or deficiency-risk
questions.

## Capture with low friction

- A photo, voice note, or rough phrase can be a complete meal log.
- Preserve useful real-life context when the user volunteers it, such as eating out, alcohol, a late meal, stress, travel, illness, or social context.
- Use existing canonical surfaces. Save meal facts to meal records, symptoms to their typed surface, and durable unstructured context to the best-fit existing journal or memory surface. Do not duplicate the same fact across stores.
- After every verified private meal mutation, apply default attachment intent for its eligible daily nutrition card. For response-card attachment eligibility only, treat the accepted meal message as explicitly requesting that card; this is not an explicit numeric-card request and does not authorize target derivation, a paused proposal, or any Goal mutation. When the complete card safety, accepted active-goal authority, fresh same-date totals, route, and bounded-card checks pass and the card alone completely answers the turn, attach that card as the complete response with no companion prose. Without an already accepted complete bundle, or when any other prerequisite fails, keep the truthful fallback short and aligned with the user's focus. Never replace a failed card gate with improvised totals, goals, analysis, or a second response surface.

## Provide numbers by default, with safety exceptions

- Provide calorie and macro estimates by default when logging a meal, using available label facts or clearly marked estimates with provenance, confidence, and the key assumptions.
- Do not estimate or surface calories or macros for intuitive-eating contexts, eating-disorder risk, or number-sensitive users. In symptom or digestion work, keep numbers secondary to the focus rather than leading with them.
- Structured label facts may remain available when useful; surface the details relevant to the user's request alongside the default totals.

Before every requested daily nutrition card, read and apply
`$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-safety.md`,
even when all five goals already appear to exist. Its complete active-condition
and active-regimen discovery is mandatory before numeric target derivation as
well as before a card; the five-record context projection is not completeness
proof. Its complete `vault-cli memory show --format json` read is also mandatory
because the snapshot does not inject the canonical Identity, Preferences,
Instructions, and Context memory document; a failed or unreadable memory read
fails closed, while missing or ambiguous age alone is not a universal block.
Its lifetime canonical procedure-event and encounter-diagnosis discovery,
bounded body-measurement read, separate `pregnancy-test` measurement read, and
bounded canonical test-event list plus required detail reads are likewise
mandatory before deriving, saving, or surfacing a proposal and again before
activating one. Also read and follow the
target-authority and complete active-Goal discovery contract in
`$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-goals.md`
before deciding that the accepted active bundle is complete for the card. Use its
proposal workflow only if a target is genuinely missing after that read and the
member made an explicit numeric-card or target-setting request. Default meal-card
intent never invokes it.
Treat a routine daily-card request, including a requested meal estimate needed
for that card, as one fulfillment workflow. Reply once with the card or one
concise truthful fallback. Never narrate individual safety, totals, estimation,
or target-resolution mechanics.
The first setup response explains a paused canonical proposal in ordinary text;
it does not attach a goal-less card. An unambiguous acceptance may complete the
pending explicit card request in that next response after the complete safety
recheck passes, activation and readback succeed, and a fresh same-date totals
read completes. Other later eligible responses may
use the accepted active goals in a card.

## Ground numeric estimates in label and USDA data

Treat every calorie or macro estimate as two separate questions:

1. Which nutrient density or exact label facts apply?
2. How much was actually eaten, including preparation and additions?

Do not let vision or memory answer both. For every numeric meal estimate—including
interactive meal logs, user-sent photos, automatic-meal-capture enrichment, and
scheduled closeouts—resolve nutrient density from the hosted food-label database
for every identifiable material component. Use the photo, description,
and conversation to estimate identity, quantity, and preparation; use returned
label or USDA facts for calories and macros. If another meal skill says to
estimate visible ingredients or portions, that means estimate those quantities
and preparation assumptions, not nutrient density from memory.

Before calculating a meal total:

- Enumerate the material components separately. Count discrete pieces or slices
  when visible, and include cooking oil, butter, dressing, sauce, cheese,
  toppings, and caloric drinks when they are visible, named, or strongly implied
  by the preparation. Do not silently assume restaurant or prepared food has no
  added fat.
- Use `vault-cli food search-labels` for one item or
  `vault-cli food search-labels-batch` for several before estimating from memory
  or searching the web. Use `--generic` for ordinary ingredients where a USDA
  generic row is preferable; use normal lookup for branded, packaged, menu, UPC,
  or exact-FDC searches. Because `--generic` applies to the whole batch, split a
  mixed meal into at most two lookups: one generic USDA batch and one normal
  branded/menu/package batch. The default returns one compact nutrition match
  per component with serving, calories, protein, carbohydrate, fat, fiber, and
  a bounded exact-product contaminant summary. Read `contaminantSummary` by
  default: `no_known_product_tests` means evidence is unknown, observations are
  measured or reported findings rather than verdicts, and truncation means more
  linked evidence exists. When an alert includes `screeningPolicy`, use its
  exposure and ratio to interpret unlike result/threshold units and state its
  fixed serving-per-day and body-weight assumptions; that context is not a
  personalized safety verdict. `murphConcernLevel` is the strongest
  threshold-screening result among the linked tests, not product safety or
  personal risk. `none` means no represented comparable observation triggered
  an alert, not that no contaminants were measured. Alerts are a subset of
  observations; never add their counts together. For a routine meal log, inspect
  the summary silently and mention it only when the user asks or a material
  exact-product alert warrants a brief, source-specific screening caveat. For a
  material alert, attribute the measured result to `source`, and attribute the
  concern level, exposure, and ratio to Murph's comparison against the named
  `threshold.authority` and threshold. Never say the source reported a concern
  level unless the evidence explicitly states that. Do not inject unknown or
  `none` results into every acknowledgment. Increase `--limit`
  only for an ambiguous match, and
  use `--full-label` whenever the user needs a fact outside that compact
  response. This includes sugars, saturated fat, cholesterol, sodium or other
  micronutrients, ingredients, allergens, or complete contaminant observation,
  sample, source, and threshold details.
- Prefer an exact visible or user-named product, restaurant item, variant, UPC,
  or FDC id over a nearby generic substitute. Never merge nutrition from
  similarly named variants without evidence that they are the same item.
- Read the returned serving basis before scaling. Determine whether nutrition is
  per labeled serving, per stated gram amount, or per 100 g, then scale it to the
  estimated amount actually eaten. A database serving is not evidence that the
  user ate exactly one serving.
- Sum component estimates only after that scaling. Give a central estimate plus
  a useful range when portion size, preparation, hidden fat, or exact identity
  could materially move the total. Avoid fake precision; set confidence from
  the weakest material identity, quantity, or preparation assumption.

Increase the result limit only when the first match is ambiguous or missing a
likely variant. If the database is unavailable or incomplete, use an
official label, manufacturer, or restaurant menu source. Only after those fail
may you use a clearly marked memory-based estimate with the assumptions and
material uncertainty stated. Never invent an exact label or imply that a visual
portion estimate was database-measured.

For a fridge or pantry photo, enumerate distinct visible products and resolve
them in one batch. Summarize only relevant nutrition, ingredient, allergen, and
uncertainty flags. Do not create recurring food records from a scan unless the
user asks.

When an exact label matters to a meal, preserve serving size and returned label
nutrition on the meal with label-based provenance. For USDA generic rows, use
database provenance and retain the lookup id or source detail used for scaling.
For a user-approved recurring or pantry item, save or update the food record with serving, ingredients,
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
