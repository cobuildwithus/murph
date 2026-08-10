# Daily nutrition-card safety

Read and apply this complete gate before deriving, saving, or surfacing numeric
nutrition goals, before activating a paused nutrition proposal, and before every
`daily_nutrition` attachment, including when five accepted active goals already
exist and during a scheduled closeout. An active goal records prior acceptance;
it does not prove that numeric guidance is still safe in the member's current
context.

- Reuse already-known conversation and vault context. Do not turn a routine card
  into a universal medical screening checklist, but do not ignore a safety fact
  that is already known or becomes known later. The context snapshot's visible
  condition and medication-regimen rows are navigation only, not proof that the
  canonical active sets are complete.
- Before deriving, saving, or surfacing numeric nutrition goals and before every
  goal-aware card, run both `vault-cli condition list --status active --limit 200
  --format json` and `vault-cli regimen list --status active --limit 200 --format
  json`. Reuse identical current-turn results. If either list fails or returns
  exactly 200 records, canonical safety discovery may be incomplete: fail closed
  with ordinary non-numeric text, no Goal or measurement mutation, and no card.
  Run no condition or regimen detail reads for a saturated pair. Otherwise, run
  `vault-cli condition show <condition-id> --format json` for every returned
  active condition and `vault-cli regimen show <regimen-id> --format json` for
  every returned active regimen. Inspect the complete detail sets before applying
  the exclusions below; never select records by title, substance, severity,
  context-snapshot visibility, or the default list prefix. If any required detail
  read fails or is unreadable, use the same fail-closed behavior. A scheduled
  occurrence asks no question when this read is unavailable or suppresses numeric
  output.
- As part of the same pre-numeric and pre-activation gate, run one bounded
  lossless canonical-entry read for the current local date: `vault-cli
  measurement entry list --metric bmi --metric height
  --metric weight --metric body-weight --from <45-days-before-today> --to
  <today> --limit 200 --format json`. Reuse an identical current-turn result
  instead of repeating it. Resolve only the newest unambiguous evidence inside
  that window: either a direct `bmi` row whose unit is canonically equivalent to
  `kg/m^2` (including `kg/m2` and `kg_m2`), or height and weight rows that share
  the same `eventId` and have units that can be converted unambiguously. Do not
  combine height and weight from different events or dates, and do not use
  stale, malformed, conflicting, or unit-ambiguous values.
  A usable adult BMI below 18.5 suppresses numeric goals, every Goal write or
  activation, and the card. If the read fails, or a 200-record result is
  saturated without resolving whether usable BMI evidence is present, fail
  closed for numeric setup, proposal presentation, Goal mutation, activation,
  and card presentation. Leave an existing paused proposal unchanged and use
  ordinary non-numeric text. Otherwise missing measurements are unavailable
  evidence, not a universal block. Never ask a scheduled occurrence for these
  measurements and never mutate measurement records during this check.
- Do not derive, save, or surface numeric goals, and do not attach a goal-aware
  card, for intuitive-eating or number-sensitive contexts; known or suspected
  eating disorder, severe restriction, purging, compulsive exercise, rapid or
  unexplained weight change, under-fueling or RED-S concern; known underweight
  (including adult BMI below 18.5 when current height and weight are available),
  frailty, or malnutrition risk; anyone under 18; pregnancy or breastfeeding;
  glucose-lowering medication; kidney disease, advanced liver disease,
  significant heart disease, relevant endocrine disease, post-bariatric care,
  a therapeutic diet, or another clinician-managed nutrition context.
- Treat a calorie target below 1,200 kcal/day as outside this product's
  self-directed numeric-card boundary. This applies both to an active canonical
  target at card time and to an adjusted or rounded derived result before any
  Goal write. For an existing target, first require that the containing Goal
  window and target-level dates include the exact card `localDate`; an
  out-of-window target must neither trigger nor satisfy this gate. Evaluate the
  boundary only for an exact point `dietary-calories` target in canonical
  `kcal`: its selected-value comparator must be `between` with identical
  numeric `value` and `highValue`. A one-sided threshold, non-identical range,
  or calorie target in any other unit makes the point-target card bundle
  incompatible. Never compare a threshold bound or incompatible raw number
  with 1,200, copy it as calories, convert it ad hoc, or use it for macro
  derivation. In particular, a calorie threshold whose satisfying range
  includes intake below 1,200 cannot authorize numeric self-directed card
  feedback. Suppress the card and make no managed Goal mutation. Do not raise a
  compatible low point target to the boundary and continue; stop numeric setup,
  keep ordinary supportive text, and use the body-composition or qualified-care
  owner when the member wants help with the underlying direction. This is a
  conservative product guard, not a claim that 1,200 kcal is appropriate for
  every adult.
- When this gate suppresses a card, keep the owning skill's non-numeric or
  clinical path. Do not expose stored targets or their assessments in card or
  fallback text, and do not mutate a Goal merely because the current context
  suppresses presentation.
- A scheduled occurrence uses this file only as a card-time safety check. It
  does not gain authority to ask safety-profile questions, solicit target
  inputs, derive or write goals, explain a proposal, or start target setup.
- On an explicit interactive request, explain the non-numeric boundary briefly
  when useful and answer through the owning safe path. Do not use the request
  itself as evidence that the safety gate passed.
