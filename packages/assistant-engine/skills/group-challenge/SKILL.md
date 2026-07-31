---
name: group-challenge
description: |
  Public consent, scoring, data, safety, and durable-state contract for a Murph
  group health challenge. Read whenever a group starts, runs, scores, or closes
  a challenge. Hosted Murph replaces this baseline with its complete first-party
  formation, referee, and dispatch behavior during the private runner build.
---

<!-- murph-public-group-skill-baseline:v1 -->

# Group Challenge Contract Baseline

This public file preserves the auditable challenge rules that protect consent,
data accuracy, safety, and replay. It intentionally does not contain Murph's
complete hosted social formation, comedy, cast, or dispatch playbook.

Read `group-chat` for room and authority rules. Read
`group-challenge-scorecards` only when the challenge uses teams, a shared target,
multiple metrics, weighted points, or cumulative component scoring.

## Buy-in and consent

A conversation about a challenge, a join-page visit, group membership, a data
share, a reaction, or a prior challenge does not establish challenge buy-in.
Record someone as in only after their current explicit opt-in. Full standings,
callouts, and settlement include only opted-in participants and only the agreed
metric, date window, and rules.

Health data is available only through the exact current server-authorized
`read_shared` result. Never read private one-to-one records, infer consent from
membership, reuse a stale projection, or treat a missing grant as a zero. A
permission offer requests only the disclosed scopes and grants nothing until the
member accepts.

## Narrow shared-data reads

Read the scoring scope first. One `read_shared` returns every current member
crossed with every requested scope and can fail as a whole when too large. Do not
pull diagnostics in the first read merely because they might be useful.

When the scoring read proves an exact required scope is `not_granted` for an
eligible participant, make at most one evidence-bound `offer_access` before any
later diagnostic read. When granted scoring data is missing, a second read may
request only `device-sync-status.v0` for diagnosis. If that read fails, preserve
and report the verified scoring data while saying the missing-data cause is
unverified.

A challenge kickoff must not create a group or post a permission offer as an
unrequested side effect. When an authorized up-front challenge permission
request is made, include the exact scoring scopes plus `group-email.v0` and
`device-sync-status.v0`; when it also creates a general hosted group, include the
public `group-chat` core set. Every requested item remains individually
selectable. A later standings offer may include only exact scopes the latest read
proved `not_granted`.

## Supported scoring scopes

Use only these selectable fixed projection kinds when they match the agreed
metric:

- `group-email.v0`
- `time-zone.v0`
- `sleep-times.v0`
- `sleep-duration-days.v0`
- `deep-sleep-days.v0`
- `rem-sleep-days.v0`
- `activity-days.v0`
- `workout-days.v0`
- `workouts.v0`
- `heart-rate-zones-days.v0`
- `steps-days.v0`
- `max-heart-rate-days.v0`
- `distance-days.v0`
- `active-calories-days.v0`
- `elevation-gain-days.v0`
- `floors-climbed-days.v0`
- `day-strain-days.v0`
- `workout-strain-days.v0`
- `activity-score-days.v0`
- `vo2-max-days.v0`
- `resting-heart-rate-days.v0`
- `hrv-days.v0`
- `protein-days.v0`
- `calories-days.v0`
- `carbs-days.v0`
- `fat-days.v0`
- `fiber-days.v0`
- `device-sync-status.v0`

Activity-specific scopes are selector-bearing and must carry a recognized
normalized `activityKind`:

```json
{ "projectionKind": "activity-minutes-days.v1", "selector": { "activityKind": "running" } }
```

```json
{ "projectionKind": "activity-distance-days.v1", "selector": { "activityKind": "cycling" } }
```

```json
{ "projectionKind": "activity-session-count-days.v1", "selector": { "activityKind": "sauna" } }
```

Do not widen a selector-bearing scope to every activity. Running zone-specific
selector scoring is unsupported until the public contract explicitly adds it.

Nutrition projections represent complete-day values logged in Murph, not
verified consumption. A missing nutrient day is unobserved and never zero.

## Date, provisional, and zero semantics

Use the projection's own dates and completion metadata. Never substitute the
reader's clock, the group clock, a schedule clock, or an inferred location.

- Current-local-day values are provisional unless the producer proves them
  settled.
- `deep-sleep-days.v0` and `rem-sleep-days.v0` may carry explicit
  `data.provisional: true`; do not rank or settle those records.
- `workouts.v0` dates are scoreable only through
  `calendarClosedThroughDate`. A later date is pending, not missing or zero.
- A settled date present with an empty workout list is an observed zero.
- A date absent from a projection is unobserved and must remain unscored.
- A real numeric zero supplied by an authorized projection is data and must not
  be converted to missing.

For a local-time rule such as “after 6 PM,” normalize the threshold once at
kickoff to integer milliseconds after local midnight, persist both the wording
and `thresholdLocalMs`, and compare strictly. Exactly 6 PM does not satisfy
“after 6 PM.”

Do not infer physical location from a local timestamp or a member's declared
time zone.

## Durable challenge page

Keep one canonical group-owned challenge page containing the exact participants,
rules, metric scopes, date window, scoring method, stake or payoff, accepted
changes, offer history, dispatch state, and close-out. The page is the durable
challenge owner; chat text, room memory, automation labels, and prior model
output are not alternate authority.

Every scheduled run must reread the current page and current shared facts. Never
settle from remembered standings. An explicit rule change must be recorded
before it affects scoring. Conflicts, missing state, stale grants, and malformed
pages fail closed rather than creating an implicit replacement.

## Scoring accuracy

Compute only the score the agreed rules define. Keep participant attribution by
exact group-scoped `participantId`; never join by display name, handle, array
position, or global member id.

When coverage differs, report scoped values or an unranked pattern. Declare a
settled cross-person winner only when the compared date sets and completion
semantics are compatible. Do not call partial data a complete week, reconstruct
provider data, or diagnose a member's missing record in public.

For teams, shared targets, multi-metric points, or cumulative goals, delegate
only the arithmetic and format rules to `group-challenge-scorecards`; this skill
still owns buy-in, consent, dates, diagnostics, durable state, and settlement.

## Stakes and safety

A stake or consequence is human-owned and opt-in. Never pressure a participant
through distress, embarrassment, money, health disclosure, impairment, or social
coercion. Judge the concrete act, amount, mechanics, setting, participant
context, and reversibility rather than dramatic wording alone.

Do not propose dangerous consumption, exposure, exertion, medication changes,
illegal activity, strangers, lasting humiliation, or a consequence that targets
body size, appearance, illness, disability, or private health. A safe ordinary
act does not become dangerous merely because the room describes it theatrically;
a materially hazardous act does not become safe because it is a joke.

## Close-out

At the end, use only settled authorized data, state every material missing or
pending participant plainly, apply the recorded rules once, and persist the
final result before announcing it. Do not silently change the metric, window,
point weights, team membership, stake, or tie rule to produce a cleaner ending.
