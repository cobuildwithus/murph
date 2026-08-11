# Body-Composition CLI Audit

Status: partially implemented
Reviewed: 2026-08-10
Scope: intentional fat loss, lean-mass gain, weight gain, recomposition, maintenance, and trend review

## Decision

Do **not** create separate `weight-loss` and `weight-gain` stores or large command trees.

Murph already has canonical owners for the underlying facts:

- scalar measurement events
- health goals
- meals and food
- exercise and workouts
- experiments and journals
- wearable and connected-device data
- automations and tracked-table presentation

The first missing capability was a small, generic **measurement-entry read projection**. A measurement event can contain several scalar entries, while the event-level `measurement list` compacts nested object arrays and therefore cannot reliably return the individual values needed for filtering or trend math. The lossless `measurement entry list` projection now composes those event entries with canonical scalar observation entries without changing the event-list contract. Build a deterministic generic trend read on the same use case before considering a thin `body-composition` composition.

Keep the skill as the strategy owner and the CLI as deterministic data access. Do not encode nutrition coaching inside command handlers. The remaining slices are future work; this document does not authorize hidden runtime behavior or a second canonical store.

## Current Inventory

### `measurement`

What exists:

- `measurement add` records one or more open scalar entries with canonical metric slugs, values, units, optional qualifiers and notes, occurrence time, source, media, tags, and timezone.
- `measurement import-json` preserves richer nested imports and raw provenance.
- `measurement show`, `list`, and `manifest` expose canonical events and immutable import provenance.
- `measurement entry list` returns lossless, exact-metric scalar rows from canonical `measurement`, legacy `body_measurement`, and scalar `observation` events, preserving parent-event identity and honest source shape.

What works for body composition:

- body weight
- waist and other circumferences
- body-fat or lean-mass estimates, provided the vendor metric and source remain explicit
- grouped manual check-ins
- direct or device-derived source labeling, including canonical connected-device observations

Gap:

- there is no deterministic trend summary.
- there is no shared unit-conversion contract.
- there is no safe source-aware duplicate-resolution contract.
- an assistant must still calculate trends itself, which is error-prone.

### `goal`

What exists:

- typed goal title, ID or slug, status, horizon, priority, start and target dates, domains, parent goal, and related goals or experiments.

What works:

- durable intent such as “gain strength and lean mass” or “reduce waist while maintaining performance”
- lifecycle and relationships
- a human-readable review window

Gap:

- no typed target metric, target range, intended direction, rate range, review cadence, or adjustment policy
- encoding these only in a title or free-form conversation makes deterministic status review difficult

### Food, meal, exercise, workout, journal, experiment, wearable, and device surfaces

These already provide the context a body-composition review needs. They should remain the source of truth for their domains.

Do not duplicate:

- meals into a body-composition log
- workout sets into a bulk tracker
- connected-scale values into manual weight events
- an experiment’s observations into a separate cut document

## Required Invariants

Any new surface must:

- compose canonical owners rather than create a second store
- preserve direct measurement, estimate, device, unit, timestamp, and provenance
- preserve the parent `evt_*` event ID and record kind; preserve the matched entry’s original array index for array-backed records and use `null` for scalar observations
- use the existing canonical metric-identity contract: registered aliases resolve to their owner key, while unknown custom metrics retain normalized exact identity
- avoid silently merging different BIA devices or treating estimated tissue as measured tissue
- avoid fuzzy metric matching, hidden unit conversion, and silent duplicate deletion
- never change calories, exercise, targets, goals, or automations without explicit user intent
- never derive an eating-disorder diagnosis, medical clearance, medication recommendation, or “safe” target
- return facts and uncertainty; the skill owns interpretation
- remain useful outside body composition wherever scalar measurements are used
- keep reads cheap enough for repeated assistant use
- support local and hosted execution through the existing generated CLI contract
- expose typed JSON output and focused tests

## Recommended Sequence

### P0 — generic measurement-entry filtering (delivered 2026-08-10)

The typed read projection was added without changing the current event-level `measurement list` response:

```bash
murph measurement entry list \
  --metric "body weight" \
  --from 2026-07-01 \
  --to 2026-08-01
```

Recommended behavior:

- keep `measurement list` unchanged for backward-compatible event browsing
- repeatable `--metric` with OR semantics
- normalize each query, then resolve both query and stored spelling through the existing health-metric identity owner
- registered aliases compare by owner key; unknown custom metrics fall back to normalized exact equality
- no substring, semantic, or fuzzy matching
- flatten matching canonical entries into a typed read projection; do not persist the projection
- return one row per matching entry with:
  - parent `eventId`
  - canonical `recordKind`
  - zero-based `measurementIndex` for array-backed measurement records, or `null` for scalar observations
  - `occurredAt`
  - event `source`
  - canonical `metric`
  - `value`
  - `unit`
  - optional `qualifiers` and `note`
- use `measurement show <event-id>` when the caller needs the complete grouped event
- optional `--source` and `--unit` are filters, not converters
- preserve original values and units
- order by occurrence time, then event ID, then measurement index
- do not deduplicate; surface likely duplicates as warnings or leave them for the trend layer
- provide typed empty and partial-coverage states
- perform no health interpretation

Suggested row:

```json
{
  "eventId": "evt_01JABCDEF0123456789ABCDEFX",
  "recordKind": "observation",
  "measurementIndex": null,
  "occurredAt": "2026-07-01T07:15:00-04:00",
  "source": "device",
  "metric": "body-weight",
  "value": 84.2,
  "unit": "kg"
}
```

Implementation belongs in the generic measurement read or use-case owner. Both the entry-list and trend commands should call that use case directly; one CLI command should not shell out to another.

This projection reduces model-side scanning for weight, waist, blood pressure, glucose, and every other scalar metric without inventing a body-specific schema or breaking the existing list contract.

### P0 — generic trend summary

Add a deterministic read over the same entry-level use case:

```bash
murph measurement trend "body weight" \
  --unit kg \
  --from 2026-07-01 \
  --to 2026-08-01 \
  --window 7d \
  --stat median \
  --time-zone America/New_York
```

Suggested output:

```json
{
  "metricQuery": "body weight",
  "metric": "body-weight",
  "unit": "kg",
  "timeZone": "America/New_York",
  "observations": 24,
  "sources": ["device"],
  "window": "7d",
  "stat": "median",
  "series": [
    {
      "startAt": "2026-07-01T00:00:00-04:00",
      "endAt": "2026-07-08T00:00:00-04:00",
      "value": 84.2,
      "count": 6
    }
  ],
  "firstWindowValue": 84.2,
  "lastWindowValue": 83.5,
  "absoluteChange": -0.7,
  "relativeChange": -0.0083,
  "sample": [
    {
      "eventId": "evt_01JABCDEF0123456789ABCDEFX",
      "measurementIndex": 0
    }
  ],
  "sampleTruncated": true,
  "warnings": []
}
```

Contract:

- normalize the metric argument through the same canonical identity owner used by entry filtering
- require `--stat mean|median` in the first version; do not hide a default in a generic command
- treat `--unit` as a filter
- if more than one unit remains, return a typed `mixed_units` result and no aggregate until a shared conversion contract exists
- keep existing inclusive calendar-date semantics for `--from` and `--to`
- resolve the effective timezone from explicit `--time-zone` when supplied, otherwise from canonical vault metadata; never fall back silently to the runner host timezone
- bucket observations into explicit half-open intervals `[startAt, endAt)` in the returned effective timezone
- include only non-empty windows in `series`; report sparse or missing coverage in warnings rather than inventing values
- use every matched canonical entry exactly once
- detect likely duplicate observations and surface them; do not silently delete or merge them
- surface mixed-source, sparse-window, current-day, and incomplete-coverage warnings
- return `relativeChange: null` when the first window value is zero
- do not calculate fat loss, muscle gain, calorie deficit, “on track,” or medical significance
- do not persist the trend as a new measurement
- return canonical event IDs plus measurement indexes, or a bounded sample plus total count and an explicit truncation flag, for auditability

Implementation belongs in the generic measurement query or use-case owner, with the CLI as a typed adapter.

### P1 — thin body-composition review

After the generic reads exist and repeated product use justifies another command, consider one compositional read:

```bash
murph body-composition status
```

Optional filters:

```bash
murph body-composition status --goal-id goal_123 --from 2026-07-01
```

This command should assemble, not reinterpret:

- active body-composition goal
- body-weight trend
- waist trend when present
- selected canonical training-performance pointers
- relevant recent context pointers: meals, workouts, steps, journal entries, experiments
- data coverage and source warnings

It should not:

- decide a calorie change
- pronounce a plateau
- infer muscle or fat tissue from scale movement
- create a goal or check-in
- write derived conclusions
- duplicate the full records owned by meals, workouts, journals, or experiments

The assistant loads the body-composition skill and makes the decision. If the generic reads plus ordinary goal and context commands are already sufficient, do not build this convenience command.

### P2 — typed goal targets

Extend the canonical goal schema only if status and automation workflows prove they need deterministic targets.

Minimum candidate model:

```ts
type GoalTarget = {
  metric: string
  direction: 'increase' | 'decrease' | 'maintain' | 'range'
  unit?: string
  targetValue?: number
  targetRange?: {
    min?: number
    max?: number
  }
  reviewCadence?: 'weekly' | 'biweekly' | 'monthly'
}
```

The metric must use the same canonical metric-slug normalization as measurement writes and reads. Do not introduce a second metric registry only for goals.

Do not put calorie prescriptions, automatic adjustment rules, eating-disorder flags, or model-generated plans into the generic goal entity by default. Those may belong in an explicit experiment or intervention with consent, provenance, and lifecycle.

A rate target should be added only when the product can represent:

- a range rather than false precision
- the measurement window
- who set it
- when it was reviewed
- a safe pause or escalation state
- populations for whom the skill must not use it

### P2 — review automation

A recurring review can be an ordinary Murph automation that:

1. reads the active goal
2. runs generic metric trends
3. reads selected training and context signals
4. loads `body-composition`
5. produces a private check-in
6. proposes, but does not silently enact, a change

No dedicated scheduler or body-composition daemon is needed.

### P3 — explicit check-in write

Add only when product usage proves that grouped manual check-ins are common enough to justify a convenience wrapper:

```bash
murph body-composition check-in \
  --weight 183.4 \
  --weight-unit lb \
  --waist 33.5 \
  --waist-unit in \
  --energy 4 \
  --hunger 3 \
  --training "on-plan" \
  --note "Travel week"
```

Design:

- delegate weight and waist to canonical measurement writes
- delegate subjective state to the existing journal, observation, or experiment owner selected by architecture
- orchestrate multiple canonical writes only with explicit transaction and partial-failure semantics
- return every canonical ID created
- never overwrite connected-device observations
- never require all fields
- add no body-fat estimate field unless the source and metric semantics are explicit

Do not implement this until the owner for subjective check-in fields is clear. A convenience command that creates an ambiguous new schema is worse than the existing primitives.

## Commands Not to Build

- `weight-loss start`, `bulk start`, or separate cut and bulk stores
- an automatic “calories remaining” engine based only on scale movement
- a command that treats wearable expenditure as measured total daily energy expenditure
- a command that writes BIA “muscle gained” as canonical truth
- a hidden auto-adjuster that cuts calories after one high reading
- public leaderboards for pounds lost, calories, BMI, body fat, or appearance
- a second meal, workout, goal, or experiment schema inside body composition
- rigid named diet commands when `nutrition-strategy` can implement the chosen pattern
- medication dosing or bariatric eligibility commands

## Suggested Delivery Slices

1. Delivered: `measurement entry list` plus its shared typed entry-read use case, tests, and generated contract refresh
2. `measurement trend` over that same use case, with tests and documentation
3. `body-composition status` only after product validation shows generic reads are too cumbersome
4. typed goal targets only after the status or automation workflow proves the need
5. convenience check-in only after canonical ownership of subjective fields is resolved

Each slice should be independently useful and avoid coupling the assistant’s evidence guidance to one command implementation.

## Acceptance Criteria for the Next CLI PR

- Existing `measurement list` output remains backward compatible.
- A model can retrieve only matching `body-weight` entries without scanning unrelated measurements.
- A grouped event remains auditable through its `evt_*` ID and measurement index, and `measurement show` still returns the complete event.
- Metric normalization reuses the write path and matching is exact canonical-slug equality, not fuzzy matching.
- Trend output is deterministic, source-aware, same-unit, timezone-explicit, and auditable.
- `--stat` is explicit, mixed units do not aggregate, empty windows do not invent values, and likely duplicates are surfaced rather than silently removed.
- No new canonical body-composition store exists.
- No command makes medical or coaching decisions.
- Existing measurement and goal data remain backward compatible.
- CLI help and generated agent contract make the new surface discoverable.
- Unit, zero-baseline, timezone, sparse-data, mixed-source, duplicate, grouped-event, and empty-state tests pass.
- The body-composition skill can use the command without inventing calculations or persisting derived facts.
