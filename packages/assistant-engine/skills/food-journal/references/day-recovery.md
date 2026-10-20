# Complete an interactive day before attaching its card

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
