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

For a connected carbohydrate, vitamin, mineral, or water question, read
`$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/references/meal-and-nutrient-reads.md`
first.

## Capture with low friction

### Routine meal log in three steps

Each step is one tool step: batch its independent calls together, in one
code-mode `exec` script when available.

1. Look up. Run the label lookups below for every material component whose
   label or USDA facts are not already known. Phrase generic queries in USDA
   order, primary food first: `bananas raw`, `milk reduced fat 2%`,
   `rice white long-grain cooked`, `chicken breast meat only roasted`. For a
   named restaurant, menu, or packaged item, run its database search and one
   official-source web search in this same step. Skip lookups for
   member-provided totals or a fully readable label.
2. Save and attach. Scale and sum the components in that same script (no
   separate calculation step), rounding to whole calories and one-decimal
   grams. Save all five metrics: when a lookup row lacks one (Foundation rows
   often omit fiber), use a marked estimate instead of omitting it, because a
   missing metric leaves the day incomplete and blocks its card. Run the
   combined save below and parse its JSON. When `dailyTotals.totalsOnlyCard`
   is non-null, attach it unchanged with `murph.attach_response_card` in that
   script; in code mode,
   `await tools.murph__attach_response_card({ card: saved.dailyTotals.totalsOnlyCard })`
   needs no tool discovery. It is the complete fresh no-goals card for the
   saved day and needs no other read. Otherwise print the save result and
   apply the recovery and accepted-goal rules below.
3. Finish. After a successful card, end with no final text unless the fixed
   optional introduction below applies.

- A photo, voice note, or rough phrase can be a complete meal log.
- Preserve useful real-life context when the user volunteers it, such as eating out, alcohol, a late meal, stress, travel, illness, or social context.
- Use existing canonical surfaces. Save meal facts to meal records, symptoms to their typed surface, and durable unstructured context to the best-fit existing journal or memory surface. Do not duplicate the same fact across stores.

Do not list meals as a prerequisite to a new capture. For recent-meal recall
or a saved-day review, read
`$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/references/meal-and-nutrient-reads.md` first.
Use the typed save flags below directly; reading this skill
already supplies the ordinary capture contract. Execute the documented save
for a resolved meal; optional enrichment is not a reason to rediscover the
schema before saving.

When the user names a restaurant and recognizable menu item, and known context
does not trigger one of the numeric safety exceptions below, resolve nutrition
before the meal mutation. Use a normal exact restaurant/menu search rather
than a generic substitute. Run this database search even when the user
supplies an official restaurant URL, together with the official-source web
search from step 1. Use an exact database result; otherwise use the official
source under the bounded source fallback below. An official menu or label does
not itself require a live browser.
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
confidence is `low`, `medium`, or `high`. Keep `--nutrition-source-detail` to
at most 240 characters: the key sources, ids or URL, and decisive assumption.
For member-provided portion totals, use `--nutrition-source user`; do not look
up a substitute estimate.
`--with-daily-totals` also works with `meal import-json` for structured ingredients.
This command shape is the execution contract. Do not rediscover these flags
through help/schema calls, repository searches, or CLI implementation reads
unless a required field is genuinely unknown or validation identifies a problem.

The successful save is the meal readback. `dailyTotals.status: available`
provides `dailyTotals.data`, the fresh canonical `meal totals --resolve-goals`
result for the saved meal's local date, including coverage and goal context.
Reuse it for the eligible same-date card; do not add `meal show`, `meal list`,
or a separate `meal totals` read just to confirm this save. With context already
known and complete nutrition, this is one save-and-read call that attaches a
non-null `dailyTotals.totalsOnlyCard` in the same step. For an ordinary card,
the rules here and in the card tool provide the
target-authority and complete active-Goal discovery contract.
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

- Provide calorie and macro estimates by default when logging a meal, using available label facts or clearly marked estimates, such as "about 640 kcal"; mention an assumption only when it changes the totals, such as an unknown amount of oil.
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

When a fresh selected-date totals read (standalone or combined save) shows any
metric `mealCount` below the top-level `mealCount`, read
`$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/references/day-recovery.md` before
any card. This applies during private meal logging and estimation, explicit app
submissions, and daily nutrition card or summary requests. Do not end with a missing-estimate refusal or a partial card
before that recovery.

## Ground numeric estimates in label and USDA data

Treat every calorie or macro estimate as two separate questions:

1. Which nutrient density or exact label facts apply?
2. How much was actually eaten, including preparation and additions?

Do not let vision or memory answer both. For every numeric meal estimate—including
interactive meal logs, user-sent photos, automatic-meal-capture enrichment, and
scheduled closeouts—reuse already verified label or USDA nutrient density for
unchanged components; resolve remaining identifiable material components from
the hosted food-label database. Use the photo, description, and conversation
to estimate identity, quantity, and preparation; use returned label or USDA
facts for calories and macros. Quantity corrections and requests for totals
do not require re-looking up unchanged products. Estimate portions, not fresh
nutrient densities from memory, before the bounded fallback below.

Before calculating a meal total:

- Enumerate the material components separately. Count discrete pieces or slices
  when visible, and include cooking oil, butter, dressing, sauce, cheese,
  toppings, and caloric drinks when they are visible, named, or strongly implied
  by the preparation. Do not silently assume restaurant or prepared food has no
  added fat.
- Use `vault-cli food search-labels 'rolled oats' --generic`
  for one item (the documented `--query 'rolled oats'` alternative is also
  accepted; never supply both forms), or
  `vault-cli food search-labels-batch` for several before estimating from memory
  or searching the web. Use `--generic` for ordinary ingredients where a USDA
  generic row is preferable; use normal lookup for branded, packaged, menu, UPC,
  or exact-FDC searches. Because `--generic` applies to the whole batch, split a
  mixed meal into at most two food lookups: one generic USDA batch and one normal
  branded/menu/package batch. Repeat the singular `--query` flag, for example:
  `vault-cli food search-labels-batch --generic --query 'chickpeas mature seeds cooked' --query 'rice brown long-grain cooked'`.
  Do not pass a JSON array or invent `--queries`. Lookups use the compact
  default output; add `--format json` only when a script parses the result. When independent label
  lookups and a needed compact memory read are known, run them in the same
  tool round; save only after their results are available.
  For a syntax failure, correct the returned field using these examples;
  if still unclear, read the command's `--help` once. Do not fetch the full
  output schema to discover a query flag or positional argument.
  The default returns one compact nutrition match
  per component with serving, calories, protein, carbohydrate, fat, fiber, and
  a bounded exact-product contaminant summary. For a routine meal log, inspect
  `contaminantSummary` silently and mention it only when the user asks or a
  material exact-product alert warrants a brief, source-specific screening
  caveat; read `$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/references/contaminants.md`
  before discussing one. Increase `--limit` only for an ambiguous match, and
  use `--full-label` whenever the user needs a fact outside that compact
  response. This includes sugars, saturated fat, cholesterol, sodium or other
  micronutrients, ingredients, allergens, or complete contaminant observation,
  sample, source, and threshold details.
- For a supplement product such as a protein powder, including one from a saved
  supplement regimen (read it with `regimen show`; `regimen list` omits
  ingredient amounts), look up only requested facts the record lacks with
  `vault-cli supplement search-labels-batch` and its saved brand and name, in
  the same tool round as any food lookups. Do not use a food lookup for it; the
  food database can return unrelated products.
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

### Bounded source fallback and corrections

- Make one database pass for unresolved components, batched as above. Correct
  malformed queries once. Increase the limit only for a genuinely ambiguous
  match; do not repeat equivalent searches after a miss or clearly wrong item.
- For unresolved branded or menu items, make one targeted web search for the
  official label/menu (`web.run` when available). Use returned official text
  when product, variant, serving, and requested values are clear; read the page
  only to resolve a material gap or conflict. For an unresolved generic food,
  target an authoritative food-composition source. Read `computer-use` and use
  its bounded browser recovery only when a material fact requires interaction
  or visual inspection unavailable through web search/text reading.
- After this bounded pass, keep the requested facts it found. For each fact
  still unresolved, briefly name the concrete blocker, such as no matching
  label, a label without that field, or an unreachable source. Give a clearly
  marked estimate or useful range only for those routine calories/macros,
  naming only an assumption that materially changes it.
  Do not keep researching minor ingredients or ask for brand details that would
  not meaningfully change the answer. Never invent an exact label or imply that
  a visual portion estimate was database-measured. New product identity or
  label evidence can justify another lookup; repetition alone cannot.
- Preserve exact evidence requirements for allergies, supplement doses,
  clinical nutrient limits, and explicit exactness requests. If the critical
  fact remains unknown, state it or ask one necessary question; an estimate is
  not proof of safety or exactness. Numeric safety exceptions still apply.
- On a correction, remove excluded components without researching them and
  rescale unchanged components from established serving facts. If editing a
  saved meal, read that record once when needed, edit the authorized record,
  and verify the result. Answer a totals request with the recalculated totals,
  never just an ingredient list or a new meal record.

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

When the user wants Murph to notice patterns before changing behavior, read
`$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/references/observation-runs.md`.

## Safety and sharing

- Private is the default. Share or generate a group-ready recap only after explicit opt-in, and omit incidental sensitive details.
- Avoid good/bad, clean/dirty, cheat, purity, compliance, streak, and score language.
- When eating-disorder risk or number sensitivity is visible, avoid unsolicited nutrition numbers and minimize prompts. Encourage appropriate professional support when risk or significant symptoms warrant it.
- Do not overclaim from sparse or confounded observations. Prefer language such as "showed up together" or "was associated with."
