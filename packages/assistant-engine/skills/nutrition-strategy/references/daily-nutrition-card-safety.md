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
  canonical active sets are complete, and it does not inject the complete
  canonical memory document.
- As part of the same gate, run `vault-cli memory show --format json` and inspect
  the complete Identity, Preferences, Instructions, and Context memory document
  for explicit, unambiguous facts relevant to the exclusions below. Reuse an
  identical current-turn result. A clearly current saved age under 18, or a
  clearly current saved intuitive-eating or number-sensitive preference,
  suppresses numeric setup, proposal presentation, every Goal write or
  activation, and every card. Missing, stale, ambiguous, or conflicting age is
  unavailable evidence, not a universal block. On an interactive request, ask
  one narrow age question only when it is necessary to resolve a decision that
  would otherwise change; a scheduled occurrence asks no question. If the
  memory read fails or is unreadable, fail closed with ordinary non-numeric
  text, no Goal or measurement mutation, and no card. Leave an existing paused
  proposal unchanged.
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
- Also run `vault-cli event list --kind procedure --limit 200 --format json`
  and inspect every returned canonical procedure item before numeric setup,
  proposal presentation, Goal mutation or activation, and every card. Reuse an
  identical current-turn result. If the list fails, is unreadable, or returns
  exactly 200 records, discovery may be incomplete: fail closed with ordinary
  non-numeric text, no Goal or measurement mutation, and no card. Run no
  procedure detail reads for a saturated list. Otherwise, the list preserves
  scalar `data.procedure` and `data.status`; when either field is missing or
  visibly truncated, run `vault-cli event show <event-id> --format json` for
  that item before deciding. If a required detail read fails or is unreadable,
  use the same fail-closed behavior. An explicit `completed` status together
  with an explicit bariatric procedure—such as gastric bypass or Roux-en-Y,
  sleeve gastrectomy or gastric sleeve, biliopancreatic diversion or duodenal
  switch, adjustable gastric band or lap band, or bariatric surgery—proves
  post-bariatric context and suppresses numeric setup, proposal presentation,
  every Goal write or activation, and every card. `ordered`, `planned`, or
  `cancelled` status, an unknown or ambiguous status, and an unrelated procedure
  are not proof of post-bariatric care and do not suppress by themselves.
  Missing procedure records are unavailable evidence, not proof that no
  procedure occurred and not a universal block. A scheduled occurrence asks no
  question and performs no mutation when this read is unavailable or suppresses
  numeric output.
- Also run `vault-cli event list --kind encounter --limit 200 --format json`
  and inspect every returned canonical encounter item before numeric setup,
  proposal presentation, Goal mutation or activation, and every card. Reuse an
  identical current-turn result. If the list fails, is unreadable, or returns
  exactly 200 records, discovery may be incomplete: fail closed with ordinary
  non-numeric text, no Goal or measurement mutation, and no card. Run no
  encounter detail reads for a saturated list. Otherwise, for every item whose
  list data reports a nonzero `diagnosesCount`, run `vault-cli event show
  <event-id> --format json` and inspect every complete diagnosis entry; never
  select encounters by title, visit type, context-snapshot visibility, or the
  default list prefix. If any required detail read fails or is unreadable, use
  the same fail-closed behavior. A safety-relevant diagnosis with explicit
  `active` status and `documented` or `suspected` certainty is current
  suppressing evidence. This includes the exclusions below, such as kidney,
  advanced liver, significant heart, relevant endocrine, pregnancy,
  eating-disorder or RED-S, underweight, frailty, or malnutrition context. If a
  safety-relevant diagnosis has missing or `unknown` status or certainty and
  its current meaning cannot be resolved safely, fail closed. `inactive`,
  `resolved`, `history`, or `rule_out` status, `ruled_out` certainty, and an
  unrelated diagnosis do not prove a current exclusion by themselves. Missing
  encounter diagnoses are unavailable evidence, not proof that no exclusion
  exists and not a universal block. A scheduled occurrence asks no question
  and performs no mutation when this read is unavailable, unresolved, or
  suppresses numeric output.
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
- Separately run `vault-cli measurement entry list --metric pregnancy-test
  --from <300-days-before-today> --to <today> --limit 200 --format json`.
  Reuse an identical current-turn result. The 300-day product window is a
  conservative buffer over [ACOG's average 280-day pregnancy
  length](https://www.acog.org/womens-health/faqs/when-pregnancy-goes-past-your-due-date);
  older rows are stale for this gate. Treat a row as an explicit positive only
  when its metric is exactly `pregnancy-test`, its unit is exactly `result`, its
  numeric value is exactly `1`, and its `qualifiers.result` string is `positive`
  after case and surrounding-whitespace normalization. Any explicit positive in the
  window suppresses numeric setup, proposal presentation, every Goal write or
  activation, and every card. It takes precedence over negative evidence in the
  same window, including a later negative from either pregnancy-evidence owner;
  a negative test is not strong enough to erase the positive safety signal.
  Missing, negative, stale,
  indeterminate, malformed, or qualifier/value-conflicting rows are unavailable
  evidence, not proof that the member is not pregnant and not a universal
  block. If this read fails, is unreadable, or returns exactly 200 records, fail
  closed with ordinary non-numeric text, no Goal or measurement mutation, and
  no card; leave an existing paused proposal unchanged. Never ask a scheduled
  occurrence about the result, and never diagnose pregnancy from this gate.
- Also run `vault-cli event list --kind test --from
  <300-days-before-today> --to <today> --limit 200 --format json` before numeric
  setup, proposal presentation, Goal mutation or activation, and every card.
  Reuse an identical current-turn result. If the list fails, is unreadable, or
  returns exactly 200 records, fail closed with ordinary non-numeric text, no
  Goal or measurement mutation, and no card; run no detail reads for a
  saturated list. Otherwise run `vault-cli event show <event-id> --format json`
  for every returned test, because generic list output compacts structured
  `results` to `resultsCount` and can truncate summaries. If any required detail
  read fails or is unreadable, use the same fail-closed behavior. Never select
  tests by title, context-snapshot visibility, `resultsCount`, or the default
  list prefix.
  Inspect the complete `testName`, `resultStatus`, optional `summary`, and every
  structured result's `analyte` and optional `textValue`. Treat a test event as
  explicit positive pregnancy evidence only when all of these are true: its
  result status is not `pending`; either the test name identifies a urine/serum
  pregnancy or hCG test, or a structured result analyte identifies pregnancy,
  hCG, beta-hCG, or human chorionic gonadotropin; and the matching result
  `textValue` or an unambiguously test-level summary explicitly says
  `positive`, `detected`, or `pregnant` after case, punctuation, and
  surrounding-whitespace normalization.
  Canonical `resultStatus` classifies the result rather than the source report's
  lifecycle, so `unknown` does not prove that a test is unfinished and may
  qualify only when the same strict test identity and explicit textual result
  rules pass. `pending` is unfinished and never qualifies, even if preliminary
  text says positive.
  A simple labeled phrase such as `Pregnancy test: positive` is explicit; a
  negated, qualified, or otherwise ambiguous phrase is not. Do not infer
  pregnancy from a numeric hCG value, reference range, `abnormal` or `unknown`
  status/flag alone, test title, or non-result note alone. Any explicit positive
  within the window suppresses numeric setup, proposal presentation, every Goal
  write or activation, and every card, and wins over negative evidence from
  either pregnancy-evidence owner in the same window. Missing, negative, pending,
  indeterminate, numeric-only, stale, unrelated, or ambiguous test evidence is
  unavailable rather than proof of non-pregnancy and is not a universal block.
  Leave an existing paused proposal unchanged. A scheduled occurrence asks no
  question, performs no mutation, attaches no card, and never diagnoses
  pregnancy from this gate.
- Do not derive, save, or surface numeric goals, and do not attach a goal-aware
  card, for clearly current intuitive-eating or number-sensitive contexts;
  known or suspected
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
- A scheduled occurrence never gains authority to ask safety-profile questions,
  solicit target inputs, activate a proposal, or attach a card from provisional
  targets. The owning automatic-meal-capture skill has one narrower exception:
  after this complete gate passes, its first eligible managed closeout may use
  already-known responsible inputs to create and explain one paused proposal
  when complete all-status Goal discovery proves that the managed Goal has
  never existed. Every later scheduled occurrence remains card-time-only and
  may not create, change, or automatically repeat a numeric proposal.
- On an explicit interactive request, explain the non-numeric boundary briefly
  when useful and answer through the owning safe path. Do not use the request
  itself as evidence that the safety gate passed.
