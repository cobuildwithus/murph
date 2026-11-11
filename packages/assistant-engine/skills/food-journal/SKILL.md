---
name: food-journal
description: Meal capture, corrections, calorie and macro estimates, daily nutrition cards, and looking back at how food relates to symptoms, energy or performance.
---

# Food journal

A photo, a voice note or a rough phrase is a complete meal log. Save it with
calorie and macro estimates and answer with the day's nutrition card. Ask a
question only when the answer would materially change the record. Otherwise
take the likelier reading and put the assumption in `--note`.

Meal records are private, and the nutrition card is for the member's private
conversation. In a group, reply in text, and write a recap of someone's meals
only when they ask for one, leaving out incidental sensitive details.

## Members who should not see numbers

Check this first. When known context shows eating-disorder risk, an
intuitive-eating approach, or a member who has asked not to see numbers, save
the meal with its name, note and ingredients only. Skip lookups, nutrition
flags, `--with-daily-totals` and the card, and reply with one short line. Do
not ask a question whose only purpose is to make an estimate possible. Suggest
professional support when risk or symptoms warrant it.

Preferences normally arrive in the saved context at the top of the
conversation. If they are missing, add
`vault-cli memory show --compact --format json` to step 1 and reuse that one
read for the rest of the turn.

## Routine meal log

A meal log takes three tool steps. Batch the independent calls of each step
together, in one code-mode `exec` script when available.

1. **Look up.** Run the label lookups (see Lookups) for every material
   component whose label or USDA facts are not already in this conversation.
   For a named restaurant, menu or packaged item, run its database search and
   one official-source web search in this same step. Skip lookups when the
   member gave the totals or sent a fully readable label. If you ran the
   lookups in the same step that read this file, go to step 2.
2. **Save and attach.** In one script: scale each component to the amount
   eaten, sum them, round to whole calories and one-decimal grams, run the save
   command below and parse its JSON. When `dailyTotals.totalsOnlyCard` is
   non-null, attach it unchanged in that same script:
   `await tools.murph__attach_response_card({ card: saved.dailyTotals.totalsOnlyCard })`.
   It is the complete card for the day and needs no tool discovery and no
   further read. When it is null, print the save result and follow "When the
   card is not ready".
3. **Finish.** After the card attaches, end the turn with no text. The one
   exception is the first-card invitation below.

A meal sent in reply to a scheduled check-in is an ordinary meal log and
follows these steps.

## The save

```sh
vault-cli meal add --with-daily-totals --format json \
  --name "<dish name>" --note "<meal and portion>" --occurred-at "<ISO date/time>" \
  --nutrition-calories <kcal> --nutrition-protein-grams <g> \
  --nutrition-carbs-grams <g> --nutrition-fat-grams <g> --nutrition-fiber-grams <g> \
  --nutrition-source <user|label|database|inherited|estimated> \
  --nutrition-confidence <low|medium|high> \
  --nutrition-source-detail "<sources, ids or URL, and the deciding assumption>"
```

- Pass all five nutrition values every time. When a lookup row lacks one
  (Foundation rows often omit fiber), estimate it. A missing value leaves the
  day incomplete and blocks its card.
- `--name` is the dish in sentence case: 2 to 5 words, 40 characters at most,
  as specific as the evidence allows ("Green smoothie", "Vegetable soup").
  Portions, brands, places and uncertainty go in `--note`. Leave out meal-type
  prefixes and photo-review wording.
- `--nutrition-source` is `user` for totals the member gave (do not look up a
  substitute), `label` for a product label or a restaurant's published facts,
  `database` for rows the label database returned, `inherited` for totals
  copied from an earlier meal, and `estimated` for everything else. Set
  confidence from the weakest material assumption about identity, amount or
  preparation. The source detail holds 240 characters at most.
- Put context the member volunteers (eating out, alcohol, a late meal, stress,
  travel, illness) in `--note`. A symptom goes in its own symptom record. Save
  each fact in one place.
- Log only food or drink the member consumed. A non-food image, or food they
  did not eat, is never a meal.
- `meal import-json` also accepts `--with-daily-totals`, for structured
  ingredients.
- The save result is the readback. Do not follow it with `meal show`,
  `meal list` or `meal totals`.
- `dailyTotals.status: unavailable` means the meal saved and only the totals
  read failed. Retry only
  `vault-cli meal totals --from <date> --to <date> --resolve-goals --format json`.
  Never repeat the save, because that would create a second meal.

## Lookups

```sh
# ordinary ingredients: USDA rows, primary food first
vault-cli food search-labels-batch --generic --query 'chickpeas mature seeds cooked' --query 'rice brown long-grain cooked'
# branded, packaged, menu, UPC or exact FDC items
vault-cli food search-labels-batch --query '<brand product variant>' --query '<restaurant menu item>'
# one item
vault-cli food search-labels 'rolled oats' --generic
```

- Word generic queries the way USDA does: `bananas raw`,
  `milk reduced fat 2%`, `chicken breast meat only roasted`.
- `--generic` applies to the whole batch, so a mixed meal takes at most two
  calls: one generic, one branded. Repeat `--query` once per food. There is no
  `--queries` flag and no JSON array. The single-item command takes the query
  as its argument or as `--query`, never both.
- Each query returns one compact match: serving, calories, protein,
  carbohydrate, fat, fiber and a contaminant summary. Raise `--limit` only for
  an ambiguous match. Add `--full-label` for sugars, saturated fat, cholesterol,
  sodium, micronutrients, ingredients, allergens or full contaminant detail.
  Add `--format json` only when a script parses the output.
- If a query is rejected as too long, retry once with the brand, product name
  and variant inside the stated limit. Do not move the same text to another
  lookup command or to the web. If the syntax is still unclear, read that
  command's `--help` once. Do not mention a lookup error you recovered from.
- Supplement products such as protein powder use
  `vault-cli supplement search-labels-batch --query '<brand and name>'`. Do
  not use a food lookup for it; the food database can return unrelated
  products. For a product in a saved regimen, `vault-cli regimen show <id>`
  has the ingredient amounts and `regimen list` does not. Look up only what
  the record lacks.
- Make one database pass per meal. Do not repeat an equivalent search after a
  miss. New product details justify one more.

## Estimating

Every estimate answers two separate questions: what is this food's nutrient
density, and how much of it was eaten. Take density from label or USDA rows.
Take identity, amount and preparation from the photo, the description and the
conversation. Do not let vision or memory answer both.

- List the material components separately. Count visible pieces or slices, and
  include oil, butter, dressing, sauce, cheese, toppings and caloric drinks that
  are visible, named or implied by the preparation. Assume restaurant and
  prepared food has added fat.
- Prefer the exact product, menu item, variant, UPC or FDC id over a generic
  stand-in. Do not merge facts from similarly named variants.
- Read the row's serving basis (per serving, per stated grams, or per 100 g)
  and scale to the amount eaten. The row's serving size says nothing about how
  much the member ate.
- Reuse facts already looked up in this conversation. Quantity corrections and
  requests for totals do not require re-looking up unchanged products.
- When the database has no usable row for a branded or menu item, make one
  targeted web search for the official label/menu (`web.run` when available)
  and read the page only to settle a material gap. For a generic food, use one
  authoritative food-composition source. Read `computer-use` only when a
  material fact needs page interaction. After that one pass, save a clearly
  marked estimate with the deciding assumption in the source detail. Do not
  keep researching minor ingredients or ask for brand details that would not
  move the total.
- Never present an estimate as a label fact, or a portion judged by eye as
  measured.
- Preserve exact evidence requirements for allergies, supplement doses,
  clinical nutrient limits, and explicit exactness requests. If the fact stays
  unknown, say so or ask the one necessary question. An estimate cannot confirm
  safety or an exact figure.
- When you answer in text instead of with a card, give the central estimate
  ("about 640 kcal") and add a range only when portion or hidden fat could move
  it materially. For a label fact you could not find, say what blocked it: no
  matching label, a label without that field, or an unreachable source.

## The first-card invitation

After the member's first complete totals-only card attaches, end with exactly:

> Here’s your nutrition card. If you’d like, we can set up goals too.

Send it once. Skip it when memory or this conversation shows the invitation
was already sent or is pending, the member declined goals in any wording, or
numbers are off for them. If memory cannot be read, skip it and still attach
the card. Add nothing around it. The runtime records that it was sent, so
write no memory note yourself.

A meal log, a reply to a check-in, silence, or a yes to a reminder never sets,
accepts or changes nutrition goals. When the member asks to set up or change
goals for the card, read
`$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-goals.md`.

## When the card is not ready

`totalsOnlyCard` is null in three cases. Look at `dailyTotals.data`:

1. Any metric's `mealCount` is below the top-level `mealCount`. Another meal
   that day has no nutrition. Read
   `$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/references/day-recovery.md` and
   complete that meal before any card. Do not send a partial card or a
   missing-estimate refusal.
2. `goalContext.status: ready`. The member has accepted goals. Read the full
   `murph.attach_response_card` description (native `tool_search` or code-mode
   `ALL_TOOLS`) and attach the goal-aware card, copying the totals and the five
   targets unchanged from `dailyTotals.data`.
3. `goalContext.status` is `conflict`, `incompatible` or `capacity`. Reply
   with one short truthful line. Attach no card and change no goal.

Never write your own totals, targets or analysis in place of a card that could
not attach. A later meal or goal change makes these totals stale, so read them
again before another card.

For a card or daily-summary request with no new meal, run
`vault-cli meal totals --from <date> --to <date> --resolve-goals --format json`,
apply the same three cases, and build the card from the card tool's
description. Reply once, with the card or one short fallback.

## Changing a meal that already exists

Edit the existing meal. Never add a second meal for the same eating occasion.

- When the member says what a photo meal was, or gives its portion, run
  `vault-cli meal edit <meal-id>` with `--name` and the nutrition flags
  together, then read it back with `vault-cli meal show <meal-id> --format json`.
  The photo stays on the meal.
- For a correction, drop excluded components without researching them, rescale
  the rest from facts already established, edit, and read back. If they asked
  for totals, answer with the new totals.
- `meal edit` has no `--with-daily-totals`. After an edit, run the
  `meal totals` command above for that date and follow "When the card is not
  ready" for its card.
- For meals the iPhone app imported (a photo with no nutrition yet), read
  `$MURPH_ASSISTANT_SKILLS_ROOT/automatic-meal-capture/SKILL.md` before
  enriching, merging or deleting them.

## Other cases

- **Recipe portion.** A saved recipe lists one whole batch. Estimate the batch
  size from its ingredient amounts, scale to the amount the member describes,
  and save a marked estimate. Never ask the member for the batch size.
- **Restaurant or packaged item.** Resolve nutrition before saving, so the
  member never has to repeat the item. Use an exact database match. Without
  one, use the official source, saved as `--nutrition-source label` with its
  URL in the source detail. Without that, save a marked estimate. Run the
  database search even when the member sends the restaurant's URL. Ask only
  when a variant or size would materially change the record.
- **Fridge or pantry photo.** Look up the distinct visible products in one
  batch and summarize only the relevant nutrition, ingredient, allergen and
  uncertainty points. Create food records only when asked.
- **A food the member wants kept for reuse.** Save or update the food record
  with serving, ingredients, nutrition and the label lookup id.
- **Contaminant summary.** Read it silently. Mention it only when asked or
  when an exact-product alert is material, and read
  `$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/references/contaminants.md`
  before discussing one. It describes that exact product only and says nothing
  about similar names or brands.
- **How to start tracking meals, or the iPhone app.** Read
  `$MURPH_ASSISTANT_SKILLS_ROOT/automatic-meal-capture/references/setup.md`.
  In a group, answer with manual capture (text, voice note, photo).
- **Saved-meal recall, a day review, stored nutrient totals, and connected
  carbohydrate, vitamin, mineral or water questions.** Read
  `$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/references/meal-and-nutrient-reads.md`.
  Do not list meals before logging a new one.
- **"Notice patterns before I change anything."** Read
  `$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/references/observation-runs.md`.
- **What to eat next, or judging a diet.** Read `nutrition-strategy`.

## Wording

Leave out good/bad, clean/dirty, cheat, streak and score language. In symptom
or digestion work, lead with the symptom question and keep numbers secondary.
Describe a pattern as "showed up together" or "was associated with", because a
few logged days cannot show cause.
