# Daily nutrition-card safety

Read and apply this gate before every `daily_nutrition` attachment, including
when five accepted active goals already exist and during a scheduled closeout.
An active goal records prior acceptance; it does not prove that numeric guidance
is still safe in the member's current context.

- Reuse already-known conversation and vault context. Do not turn a routine card
  into a universal medical screening checklist, but do not ignore a safety fact
  that is already known or becomes known later.
- Before any card, run one bounded lossless canonical-entry read for the current
  local date: `vault-cli measurement entry list --metric bmi --metric height
  --metric weight --metric body-weight --from <45-days-before-today> --to
  <today> --limit 200 --format json`. Reuse an identical current-turn result
  instead of repeating it. Resolve only the newest unambiguous evidence inside
  that window: either a direct `bmi` row whose unit is canonically equivalent to
  `kg/m^2` (including `kg/m2` and `kg_m2`), or height and weight rows that share
  the same `eventId` and have units that can be converted unambiguously. Do not
  combine height and weight from different events or dates, and do not use
  stale, malformed, conflicting, or unit-ambiguous values.
  A usable adult BMI below 18.5 suppresses numeric goals and the card. If the
  200-record result is saturated without resolving whether usable BMI evidence
  is present, suppress the card; otherwise missing measurements are unavailable
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
