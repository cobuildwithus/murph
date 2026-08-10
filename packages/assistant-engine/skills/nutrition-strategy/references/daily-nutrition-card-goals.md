# Daily nutrition-card goals

Use the target-authority and canonical-discovery rules below after every explicit
interactive request to set nutrition targets or receive a numeric daily
nutrition card, even when the visible context appears to contain a complete
bundle. Use the proposal workflow only when the complete read proves that the
member does not already have one unambiguous, unit- and comparator-compatible
daily target for calories, protein, carbohydrate, fat, and fiber. A scheduled
closeout follows the equivalent discovery contract in its owning skill and may
use an already accepted active bundle, but it must not use this workflow to ask
for inputs, derive or save targets, or surface a proposal.

Before using this workflow, read and apply `daily-nutrition-card-safety.md`,
including its complete canonical memory document, bounded active-condition and
active-regimen discovery, 45-day body-measurement read, and separate 300-day
`pregnancy-test` read. The context snapshot is not completeness proof for any
of these owners. If any required canonical read is saturated or unavailable,
or the gate suppresses numeric goals, stop here with no Goal or measurement
mutation and keep the owning non-numeric or clinical path.

A numeric card request explicitly asks for Murph's goal-aware daily-card
experience. It authorizes only the one paused canonical proposal below so the
provisional values do not live in transient assistant state; it does not accept,
activate, or use those targets. The explanation and explicit later acceptance
remain required before the proposal can affect a card.

## Target authority

- Before treating any target bundle as complete or deciding that a metric is
  missing, run `vault-cli goal list --status active --limit 200 --format json`.
  If it returns 200 records, the bounded read may be incomplete: fail closed
  with ordinary text, no Goal or measurement mutation, and no card. Otherwise,
  run `vault-cli goal show <goal-id> --format json` for every returned active
  Goal whose list item reports a nonzero `data.metricTargetsCount`. Do not
  select detail reads by title, slug, domain, context-snapshot visibility, or
  the default list prefix. Resolve metric identity, unit, comparator, effective
  date, conflicts, and the 1,200-kcal boundary only after inspecting that
  complete detail set. Keep this active-target authority read separate from the
  all-status lookup used below to reuse or honor Murph's managed paused or
  abandoned proposal; neither read substitutes for the other.
- Read already-known goals, body measurements, training, weight trend, activity,
  and stated body-composition direction before asking. Never infer a missing
  physiological sex input from a name, pronouns, or gender label, and never infer
  usual activity from a few workouts or one wearable day.
- A member- or clinician-chosen active target always wins for its metric. Do not
  replace it, average conflicts, or create a default over it. A range or dynamic
  target cannot be collapsed into the card's scalar target; ask one narrow
  question or use ordinary text instead.
- Comparator compatibility is part of target authority. This point-target card
  and its managed derivation accept a selected-value target only when its
  comparator is `between` and its numeric `value` and `highValue` are identical.
  A one-sided `<`, `<=`, `>`, or `>=` threshold, a non-identical `between`
  range, or any other target shape remains authoritative canonical state but is
  incompatible with this workflow. Never translate its bound into a point:
  do not expose, compare, or copy it into the card; use it for the 1,200 kcal
  boundary, residual-energy, or fiber calculations; or create, replace, or
  remove managed targets around it. Use ordinary text or one narrow interactive
  question without mutation; a scheduled closeout asks nothing and sends no
  card. Apply this rule before any low-energy check or derivation. Multiple
  active explicit owners are also ambiguous.
- Unit compatibility is part of target authority. This fixed-unit workflow
  accepts only `dietary-calories` in `kcal`, and `protein-grams`, `carbs-grams`,
  `fat-grams`, and `fiber-grams` in `g`. An explicit target in another unit
  remains authoritative and must not be overwritten, but its raw value must not
  be compared with the 1,200 kcal boundary, copied into a card, or used by the
  residual-energy or fiber calculations. Do not invent a card-specific
  conversion. Without an existing owning conversion that yields the exact
  canonical unit, treat the bundle as incomplete and incompatible: perform no
  managed Goal mutation, use ordinary text or one narrow interactive question,
  and let a scheduled closeout use ordinary text without a question or card.
  Apply this rule before any low-energy check or derivation.
- Effective dates are also part of target authority. Resolve them against the
  exact card `localDate`: the selected capture date for a scheduled closeout,
  which may be a historical catch-up date rather than the occurrence date, or
  the explicitly requested date. Never use wall-clock today as a substitute.
  The containing Goal applies only when
  `window.startAt <= localDate` and its optional `window.targetAt` is absent or
  `localDate <= window.targetAt`. A target inside it also applies only when its
  optional `startAt` is absent or `startAt <= localDate`, and its optional
  `targetAt` is absent or `localDate <= targetAt`; both boundaries are
  inclusive. An out-of-window target remains canonical authority for its own
  period, but it is not a current owner or conflict: do not copy or expose its
  value, compare it with the 1,200 kcal boundary, derive from it, or let it
  cause any managed Goal mutation. If one complete applicable bundle does not
  remain, use ordinary text or one narrow interactive question with no
  mutation; a scheduled closeout asks nothing and sends no card.
- After explicit interactive target-setting intent, if one consolidated question
  can collect the genuinely missing inputs, ask it once. Until a responsible
  calorie estimate and all five goals exist, save no active defaults and attach
  no card.

## Derive a conservative proposal

Keep population guidance separate from Murph's product judgment.

1. **Calories.** Prefer representative measured total energy expenditure, or a
   member-confirmed usual intake that coincided with a stable multi-week weight
   trend and usual activity. Otherwise, for adults 19 and older, use the 2023
   National Academies EER equation only when age, height in centimeters, current
   weight in kilograms, the physiological sex input supplied for this
   calculation, and a representative physical-activity category are known:

   - Men: inactive `753.07 - 10.83*age + 6.50*height + 14.10*weight`; low active
     `581.47 - 10.83*age + 8.30*height + 14.94*weight`; active
     `1004.82 - 10.83*age + 6.52*height + 15.91*weight`; very active
     `-517.88 - 10.83*age + 15.61*height + 19.11*weight`.
   - Women: inactive `584.90 - 7.01*age + 5.72*height + 11.71*weight`; low active
     `575.77 - 7.01*age + 6.60*height + 12.14*weight`; active
     `710.25 - 7.01*age + 6.54*height + 12.34*weight`; very active
     `511.83 - 7.01*age + 9.07*height + 12.56*weight`.

   Treat the result as a starting estimate, not a measured requirement. Use it
   unchanged for maintenance or recomp. For an explicit muscle-gain direction,
   start conservatively around 5-10% above maintenance; for an explicit fat-loss
   direction, start around 10-20% below maintenance and do not begin with a
   deficit larger than about 500 kcal/day. These adjustments are Murph product
   judgment informed by limited athlete literature, not DRI prescriptions.
   Round the final target to the nearest 100 kcal and plan to adjust from a
   multi-week trend, training performance, hunger, and recovery.
   If the adjusted or rounded target is below 1,200 kcal/day, stop under
   `daily-nutrition-card-safety.md`; do not floor it upward, save a Goal, or
   attach a goal-comparison card.
2. **Protein preference.** For a generally healthy adult with regular resistance
   training or a muscle-gain goal, start near 1.6 g/kg/day. Use about 1.4
   g/kg/day for other regularly exercising adults and 0.8 g/kg/day for a
   generally healthy non-exercising adult when weight is a responsible
   reference. Round to the nearest 5 g. This is the preferred derived protein
   value when more than one macro is missing, not authority to override an
   explicit metric or an energy-feasibility check.
3. **One residual-energy algorithm.** Run this only after the calorie target and
   every explicit protein, carbohydrate, and fat target are proven applicable
   to the proposal's card date and exact points with comparator `between` and
   identical endpoints, then prove the calorie target is in `kcal` and each
   macro target is in `g`. Hold those applicable, compatible explicit targets
   fixed. Use 4 kcal/g for protein and carbohydrate and 9 kcal/g for fat. Then
   derive only missing macros:

   - With exactly one macro missing, assign that macro the remaining energy.
   - With protein plus another macro missing, start from the weight-based protein
     preference, but clamp it to the feasible value nearest that preference
     inside the 10-35% protein AMDR that leaves the other missing macro inside
     its AMDR. If no such value exists, the bundle is infeasible.
   - With fat and carbohydrate both missing, choose the feasible fat share
     closest to 30%, or closest to 25% when running or another endurance demand
     is material; carbohydrate receives the remainder. Fat must remain within
     20-35% and carbohydrate within 45-65%.
   - With all three macros missing, apply the protein rule first, then the
     fat-and-carbohydrate rule.

   Round each derived missing macro to the nearest 5 g, then recompute the full
   bundle once. Every explicit value must remain unchanged, each macro must be
   inside its adult AMDR, and `4*protein + 4*carbohydrate + 9*fat` must be within
   50 kcal of the calorie target. Do not independently reapply percentage
   defaults after an explicit value consumes part of the energy budget. If the
   residual is negative, the feasible interval is empty, rounding breaks an
   AMDR or the 50 kcal tolerance, or known inputs cannot prove one result, do
   not write or update the Goal. Explain the conflict and ask which explicit
   target the member wants to change.

   Example: with explicit 2,000 kcal, 150 g protein, and 250 g carbohydrate,
   fat is the sole missing macro. Residual energy gives about 44 g, which rounds
   to 45 g; the 2,005 kcal macro total and all three shares pass. With the same
   calories and protein but explicit 300 g carbohydrate, the residual fat is
   below its 20% AMDR, so the bundle is infeasible and no Goal write is allowed.
4. **Fiber.** Start from the adult reference density of 14 g per 1,000 kcal and
   round to the nearest 5 g. This is population guidance, not a personalized
   gastrointestinal prescription.

## Save once, explain, then activate

Use the existing canonical Goal owner; add no new state surface.

1. Separately run `vault-cli goal list --limit 200 --format json`, then show only
   candidate records, to find the managed Goal in any status. If this all-status
   list is saturated or target authority is ambiguous, do not write or attach a
   card. Do not use this lookup in place of the complete active-target authority
   read above.
2. Reuse at most one Goal with slug `murph-daily-nutrition-starting-targets`.
   Create it only when absent, with title `Daily nutrition targets`, domain
   `nutrition`, horizon `ongoing`, and status `paused`. Before that first write,
   establish one proposal-effective local date. Use the member's explicitly
   requested effective date when present; otherwise use the selected card
   `localDate` for a dated card request, including a historical date; otherwise
   use the engine-supplied current vault-local date for an undated target or
   card request. Include `window: { startAt: <proposal-effective-localDate> }`
   in the initial `goal import-json` payload. Do not rely on the Goal owner's
   write-day default or substitute a wall-clock date. A paused record is the
   proposal awaiting the member's review; an abandoned or completed record is
   an opt-out and must not be recreated automatically.
3. Save only metrics without an explicit owner through
   `vault-cli goal import-json --input -`. Each point target uses `kind: "metric"`,
   `evaluation.kind: "selected-value"`, comparator `between`, and identical
   `value` and `highValue`. Use these stable target ids and metric/unit pairs:

   - `murph-default-dietary-calories`: `dietary-calories`, `kcal`
   - `murph-default-protein-grams`: `protein-grams`, `g`
   - `murph-default-carbs-grams`: `carbs-grams`, `g`
   - `murph-default-fat-grams`: `fat-grams`, `g`
   - `murph-default-fiber-grams`: `fiber-grams`, `g`

   Reuse the same Goal id and stable target ids on every update. Supplying
   `metricTargets` replaces that Goal's stored array; every edit or overlap
   removal must therefore send the complete intended post-update array for the
   managed Goal. Preserve every unchanged target and stable target id, and omit
   only a metric deliberately removed because an explicit owner now exists.
   Never send only the changed or removed target. Read the Goal back and verify
   the complete retained set and window; never create a duplicate or rewrite an
   unchanged proposal. Preserve the existing Goal window on every later value,
   overlap-removal, status, or card-request turn; omit `window` from those
   patches and never silently rebase it to another requested card date. Change
   the window only when the member explicitly changes the proposal's effective
   date, then explain that revision and verify the complete record. Any write
   that adds or changes a derived managed value must include `status: "paused"`
   atomically, even when the same Goal was active; this keeps the revised bundle
   a proposal until the member accepts it. Removing an overlapping metric
   without adding or changing a derived value may leave the managed Goal active
   because the explicit owner supplies that metric. A status-only update may
   omit `metricTargets`.
4. A turn that creates or changes the paused proposal must be ordinary text,
   never a card. Briefly name all five effective values, which facts and labeled
   assumptions materially drove them, and why calories, protein, carbohydrate,
   fat, and fiber landed there. State the proposal-effective date, especially
   when it is historical or future. Call the values provisional and invite
   correction or acceptance. This explanation must happen before the first
   goal-aware card.
5. When the member accepts the proposal, first re-run the complete
   current-context gate in `daily-nutrition-card-safety.md`, including its bounded
   canonical memory, active-condition, active-regimen, body-measurement, and
   `pregnancy-test` reads. If that gate suppresses numeric guidance, fails, or
   cannot resolve a saturated read, leave the proposal paused and unchanged,
   surface no target values, use ordinary non-numeric text, and attach no card.
   Only after that gate passes, re-read target authority. If a metric has gained an explicit
   owner, remove it from the managed proposal by sending the complete intended
   post-update array and read the Goal back. Then run
   `vault-cli goal save "Daily nutrition targets" --id <goal-id> --status active`
   and read that same Goal back. When the member changes a proposed value, or a
   missing metric needs a newly derived replacement after an explicit owner
   disappears, send the complete intended post-update `metricTargets` array
   with `status: "paused"` for the same Goal through `goal import-json`,
   explain the revision briefly, and wait for acceptance. If the member
   declines, update the same Goal to `abandoned`. Do not silently recalculate
   accepted values later. If an explicit target appears after activation, send
   the managed Goal's complete retained array without that overlapping metric;
   never edit the explicit Goal.
6. The proposal turn never attaches a card. If an explicit card request caused
   the proposal, its next unambiguous acceptance may be the first later eligible
   response: after the complete pre-activation safety gate in step 5 passes,
   activate and read back the Goal, reuse those identical current-turn safety
   reads, re-read same-date canonical meal totals, and attach exactly one card
   in that acceptance response when the pending
   request is still unambiguous and the card alone completes it. A
   target-setting-only request, correction, decline, ambiguous acceptance, or
   compound request remains ordinary text with no card. Otherwise, only a later
   eligible response with five exact point values in the exact canonical
   metric/unit pairs resolved from active canonical goals may attach the card.
   On an interactive card request, explain an existing paused proposal again
   unless the member is accepting or changing it.

## Evidence register

- [National Academies, 2023 adult EER equations and individual uncertainty](https://www.ncbi.nlm.nih.gov/books/NBK591034/)
- [National Academies adult AMDR and DRI reference tables](https://www.ncbi.nlm.nih.gov/books/NBK208874/)
- [ISSN position stand: protein and exercise](https://link.springer.com/article/10.1186/s12970-017-0177-8)
- [National Academies fiber reference method](https://www.ncbi.nlm.nih.gov/books/NBK208887/)
- [National Academies energy-risk context and the adult underweight boundary](https://www.ncbi.nlm.nih.gov/books/NBK591042/)
- [NIH/NHLBI low-calorie diet guidance and nutrient-adequacy limits](https://www.ncbi.nlm.nih.gov/books/NBK278991/)
- [Critical review of athlete weight-gain guidance and its evidence limits](https://pubmed.ncbi.nlm.nih.gov/35233712/)
- [Off-season bodybuilding review: surplus and rate-of-gain context](https://pubmed.ncbi.nlm.nih.gov/31247944/)
- [Meta-analysis: energy deficiency and resistance-training lean-mass gains](https://pubmed.ncbi.nlm.nih.gov/34623696/)
