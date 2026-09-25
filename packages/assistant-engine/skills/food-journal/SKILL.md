---
name: food-journal
description: Use for low-friction meal capture, connected meal and nutrient questions, and bounded pattern finding between food and digestion, symptoms, energy, appetite, or performance, providing calorie and macro estimates by default except in eating-disorder-risk, intuitive-eating, or number-sensitive contexts.
---

# Food journal

## Goal

Make meal capture easy, preserve the context that matters, and turn enough observations into an honest, low-pressure pattern readback.

This skill is a policy layer over existing Murph surfaces. Do not create a new food-journal store, observation entity, scoring model, streak, or CLI family.

Use `nutrition-strategy` for forward-looking decisions about what to eat or change; keep this skill focused on capture and retrospective observation. Use `behavior-followthrough` only when repeated support or missed logs become central. Use `experiment-onboarding` only after the user chooses a change to test.

In a private direct conversation, when the member asks how to start recurring
meal tracking or how Murph can track meals, read
`$MURPH_ASSISTANT_SKILLS_ROOT/automatic-meal-capture/SKILL.md` even when they do
not say "automatic." That skill owns whether the compatible-iPhone path or this
skill's manual text, voice-note, and user-sent-photo path should lead based on
known device, preference, and setup context. For a generic group request, keep
the response on group-safe manual capture unless someone explicitly asks for
the public app listing; keep personalized app setup private.

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

Do not list meals as a prerequisite to a new capture. When the member asks to
inspect a particular day's saved meals, use
`vault-cli meal list --from <date> --to <same-date> --limit 50 --format json`
and check for a truncated result before claiming complete coverage. `meal list`
has no `--date` option. Use the typed save flags below directly; reading this skill
already supplies the ordinary capture contract. Execute the documented save
for a resolved meal; optional enrichment is not a reason to rediscover the
schema before saving.

When the user names a restaurant and recognizable menu item, and known context
does not trigger one of the numeric safety exceptions below, resolve nutrition
before the meal mutation. Use a normal exact restaurant/menu search rather
than a generic substitute. Run this database search first even when the user
supplies an official restaurant URL. If that search has no exact result, read
`computer-use` and inspect the restaurant's official nutrition or menu source.
A landing page is not a failed nutrition lookup: if it lacks the item facts,
use `computer_act` to follow its relevant menu/nutrition link or search for the
exact item before deciding the official source is unavailable. Keep this
inspection focused on the requested item and serving; follow the computer
skill's bounded recovery rules if access fails. If the first page already
contains the exact item and serving facts, use them without extra navigation.
When using that official source, retain its URL in nutrition source detail.
Use `--nutrition-source label` for published official item/serving facts;
`database` is for facts returned by the food-label database.
Only after the database result, official source, or clearly marked last-resort
estimate is resolved may you call `meal add` or `meal edit` with the available
nutrition and provenance. Do not save a nutrition-free restaurant meal first
and then ask the member to repeat the item. Ask one narrow question only when a
variant or portion difference would materially change the record.

When a numeric safety exception already applies, save the meal without calorie
or macro estimates. Do not force a nutrition lookup, clarification, or safety
preflight just to capture the meal.

- After every verified private meal mutation, apply default attachment intent for its eligible daily nutrition card. This includes an ordinary meal reply to an ordinary scheduled check-in; the reply is interactive meal intent, not target acceptance or new scheduled authority. Use fresh canonical same-date totals with resolved goals, including the combined-save result below. When numeric suitability, complete stored-meal coverage, private routing, and bounded-card checks pass and the card completely answers the turn, attach it. `goalContext.status: ready` uses the unchanged five accepted snapshots; `missing` uses five explicit null goals, even when a subset of compatible targets exists. Never author a mixed bundle or derive, propose, accept, activate, or mutate goals to send a summary. Conflict, incompatible, capacity, incomplete totals after the recovery below, or other failed prerequisites retain the short truthful fallback. Never replace a failed gate with improvised totals, targets, analysis, or a second response surface.

### Save and read the day in one call

Apply the member's numeric preferences before choosing this path. If canonical
preferences are not already available in context, run
`vault-cli memory show --compact --format json` once before saving, alongside
independent label lookups when needed. Apply any numeric-suppression decision
before adding estimates or `--with-daily-totals`, not after receiving totals.
Reuse that preference read for suitability and invitation checks; do not repeat it.

For a new meal whose identity, amount, and nutrition are already resolved, use
`vault-cli meal add --with-daily-totals --format json` with the typed meal flags.
Use this complete command shape with resolved values, omitting unknown optional
nutrition fields:

```sh
vault-cli meal add --with-daily-totals --format json \
  --note "<meal and portion>" --occurred-at "<ISO date/time>" \
  --nutrition-calories <kcal> --nutrition-protein-grams <grams> \
  --nutrition-carbs-grams <grams> --nutrition-fat-grams <grams> \
  --nutrition-fiber-grams <grams> --nutrition-source <source> \
  --nutrition-confidence <confidence> --nutrition-source-detail "<evidence or URL>"
```
Nutrition source is `user`, `label`, `database`, `inherited`, or `estimated`;
confidence is `low`, `medium`, or `high`. For member-provided portion totals,
use `--nutrition-source user`; do not look up a substitute estimate.
`--with-daily-totals` also works with `meal import-json` for structured ingredients.
This command shape is the execution contract. Do not rediscover these flags
through help/schema calls, repository searches, or CLI implementation reads
unless a required field is genuinely unknown or validation identifies a problem.

The successful save is the meal readback. `dailyTotals.status: available`
provides `dailyTotals.data`, the fresh canonical `meal totals --resolve-goals`
result for the saved meal's local date, including coverage and goal context.
Reuse it for the eligible same-date card; do not add `meal show`, `meal list`,
or a separate `meal totals` read just to confirm this save. With context already
known and complete nutrition, this is one save-and-read call followed by
`murph.attach_response_card`. For an ordinary card, the rules here and in the
card tool provide the target-authority and complete active-Goal discovery contract.
Do not read the goal-derivation reference or full nutrition-strategy skill
unless the member explicitly engages in target-setting.

If `dailyTotals.status: unavailable`, the meal is still saved. Retry only the
same-date totals read; never repeat the meal mutation. A later meal or Goal
mutation invalidates this summary and requires a new totals read. Incomplete
coverage still triggers the selected-date recovery below; conflicts and numeric
suitability still apply. Omit `--with-daily-totals` when numeric guidance is
suppressed. Never make a new meal to replace an existing meal needing an edit.

### Optional introduction, not an onboarding requirement

For the first suitable complete totals-only card, include this exact brief
final text after attachment succeeds. Goal setup is optional for the member;
the first introduction should not be silently omitted when its conditions hold:

> Here’s your nutrition card. If you’d like, we can set up goals too.

Use it only when canonical memory/instructions and current conversation contain
no prior decline, number-sensitive preference, or already-sent invitation. Read
`vault-cli memory show --compact --format json` once when that context is not
already available. If prior invitation evidence is pending rather than sent,
defer another invitation; never call pending evidence delivery. Otherwise later
cards have no invitation. A missing or unreadable preference read means omit the
optional introduction, not block an otherwise eligible card. Never add analysis,
numeric values, a second summary, or a follow-up question around that fixed copy.
The runtime freezes the copy inside the card's single outbound effect and records
a Context memory note only after successful send confirmation. Do not write an
“offered” note at staging. Respect prior declines in any wording; an explicit
“no goals” preference belongs in the existing canonical Instructions/Preferences
owner. Declining the invitation is not authority to modify unrelated goals.
Silence, a meal reply, and acceptance of a reminder never accept nutrition goals.
Read `nutrition-strategy` only when the member engages in goal setup; an invitation
is neither a numeric proposal nor acceptance.


## Provide numbers by default, with safety exceptions

- Provide calorie and macro estimates by default when logging a meal, using available label facts or clearly marked estimates with provenance, confidence, and the key assumptions.
- Do not estimate or surface calories or macros for intuitive-eating contexts, eating-disorder risk, or number-sensitive users. In symptom or digestion work, keep numbers secondary to the focus rather than leading with them.
- Structured label facts may remain available when useful; surface the details relevant to the user's request alongside the default totals.

Before every requested daily nutrition card, apply the concise known-context
numeric-suitability rule in the `murph.attach_response_card` prompt. Do not run
a universal medical-history or measurement preflight. Use the fresh canonical
goal context and the card tool's authority rules
before selecting the all-null or accepted all-five presentation. Read
`$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-goals.md`
and use its proposal workflow only for an explicit target-setting request,
never merely a meal log, daily summary, numeric-card request, or scheduled closeout.
Treat a routine daily-card request, including a requested meal estimate needed
for that card, as one fulfillment workflow. Reply once with the card or one
concise truthful fallback. Never narrate individual safety, totals, estimation,
or target-resolution mechanics.

### Complete an interactive day before attaching its card

Use this selected-date recovery during private meal logging and estimation,
including explicit app submissions, as well as daily nutrition card or summary
requests. A separate request to estimate an already-saved meal is unnecessary.
When totals expose incomplete meals, inspect and complete those existing records
from available evidence, or ask one focused follow-up for essential missing
identity or amount. Do not end with a missing-estimate refusal before trying
this recovery. Keep reads bounded to the selected date; unrelated conversation
does not trigger meal recovery.

After the fresh selected-date totals read (standalone or combined save), compare every
metric's `mealCount` with the top-level `mealCount`. When any metric has lower
coverage, do not treat the normal interactive card workflow as finished with a
partial card. List only that selected date, show the exact meals that lack
nutrition, and try to complete those existing records from accepted current
conversation context, their saved identity, ingredients, and amount, and a
bounded matching prior meal when useful. A member's current statement that the
meal is equivalent to a specific prior meal is usable evidence. A similar
informal name alone is not: require matching saved ingredients and portion
evidence or ask instead of copying nutrition.

Use only the canonical meal surface for this recovery: `vault-cli meal list
--from <date> --to <date> --limit 200 --format json`, `vault-cli meal show
<meal-id> --format json`, and `vault-cli meal edit <meal-id>` with the typed
`--nutrition-calories`, `--nutrition-protein-grams`,
`--nutrition-carbs-grams`, `--nutrition-fat-grams`,
`--nutrition-fiber-grams`, `--nutrition-source`,
`--nutrition-confidence`, and `--nutrition-source-detail` flags. Never inspect
or modify raw vault files. After the date lists identify the records, show the
selected prior meal before copying its saved totals. After the edit succeeds,
run the exact edited-meal `meal show` readback and fresh same-date `meal totals`
command before attaching the card. Use `--nutrition-source inherited` for
copied prior-meal totals and preserve the prior source in
`--nutrition-source-detail`.

Apply the estimation-eligibility and label/database grounding rules below. If
the available evidence supports a meaningful bounded estimate, edit and read
back the exact existing meal, then rerun fresh same-date totals before any card.
Never add a replacement meal or calculate around the incomplete record. If
identity or amount remains too indeterminate, ask one compact question for only
that missing detail and stop without a card. The answer resumes the exact-meal
edit, read-back, fresh-totals, and eligible-card workflow. Do not ask merely to
enable numeric output for an intuitive-eating, eating-disorder-risk, or
number-sensitive member.

This generic recovery question is interactive-only. Scheduled automatic
closeout keeps the narrower question authority in `automatic-meal-capture`.
Attach a partial card only when the member explicitly asks to see the currently
available partial data after the limitation is clear; partial-card schema and
rendering remain compatibility surfaces, not the normal interactive closeout.

An explicit target-setting response still explains a paused canonical proposal
in ordinary text, not a card. Only unambiguous acceptance of that explained
proposal may activate it. When an explicit combined target-setting and card
request remains pending, the acceptance response may complete it after suitability,
activation/readback, and fresh same-date totals. Ordinary summary requests use
all-null goals when accepted authority is missing; they do not repeat a paused
proposal or change its status. Complete stored records do not prove every meal
eaten was logged; the card reports estimated nutrition logged so far.

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
- Use `vault-cli food search-labels 'rolled oats' --generic --format json`
  for one item (the documented `--query 'rolled oats'` alternative is also
  accepted; never supply both forms), or
  `vault-cli food search-labels-batch` for several before estimating from memory
  or searching the web. Use `--generic` for ordinary ingredients where a USDA
  generic row is preferable; use normal lookup for branded, packaged, menu, UPC,
  or exact-FDC searches. Because `--generic` applies to the whole batch, split a
  mixed meal into at most two lookups: one generic USDA batch and one normal
  branded/menu/package batch. Repeat the singular `--query` flag, for example:
  `vault-cli food search-labels-batch --generic --query 'cooked chickpeas' --query 'cooked brown rice' --format json`.
  Do not pass a JSON array or invent `--queries`. When independent label
  lookups and a needed compact memory read are known, run them in the same
  tool round; save only after their results are available.
  For a syntax failure, correct the returned field using these examples;
  if still unclear, read the command's `--help` once. Do not fetch the full
  output schema to discover a query flag or positional argument.
  The default returns one compact nutrition match
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
likely variant. The database-miss fallback above also applies to packaged and
manufacturer labels. Only after the applicable official source fails may you
use a clearly marked memory-based estimate with the assumptions and material
uncertainty stated. Never invent an exact label or imply that a visual portion
estimate was database-measured.

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
