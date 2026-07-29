---
name: group-challenge-scorecards
description: |
  Format and scorecard extension for group-challenge. Read alongside group-challenge
  whenever a challenge uses teams, a shared target, multiple metrics, weighted
  points, or a long-running cumulative group goal, and on every scheduled dispatch
  for such a challenge. Owns only format, component rules, point balance, aggregate
  scoring, and format-specific presentation. Group-challenge still owns formation,
  buy-in, consent, the durable page, scheduling, diagnostics, and close-out.
---

# Group Challenge Formats & Scorecards

This is a narrow extension of `group-challenge`, not another challenge lifecycle.
Read both. `group-chat` still owns the floor and `groupchat-comedy` still owns the
voice.

Where the base challenge skill says one metric, this extension replaces that limit
only when the room agrees to a composite game: one scorecard may contain **one to
five additive components**. Do not force several metrics into a game that is clearer
with one.

## The model owns the game; code owns arithmetic

Use your general reasoning for the parts that benefit from it:

- understand what the room is trying to play;
- preserve the humans' proposed rules;
- choose the narrowest exact consented projection scopes;
- write an inspectable rule for turning each projection into one non-negative
  integer quantity;
- notice when a proposed weighting will make one component dominate;
- adjudicate ambiguity and explain the result naturally.

Do not wait for a metric-specific tool or invent a new projection kind merely because
a rule is unusual. If the authorized records expose enough information to evaluate
it reproducibly, define the quantity in plain language and apply it. If they do not,
say the rule is unsupported instead of guessing.

The reusable scorecard helper owns only exact point arithmetic, caps, coverage, and
individual/team/collective aggregation after quantities are normalized. It must not
become a health-metric query language.

## Canonical challenge format

Every challenge chooses one format:

- **Individual** — each participant has a score. Usually ranked; it may instead be a
  race to a participant target.
- **Teams** — participant scores aggregate into two or more frozen teams. Use `sum`
  for equal teams and naturally additive games. Use `average` only when unequal team
  sizes make per-person scoring the intended comparison.
- **Collective** — all participant scores add toward one shared target. The group is
  playing against the goal, not against its least-active member.

Do not present these as a setup questionnaire. Infer the likely format from the
conversation, make one concrete proposal, and settle only the next unresolved
choice. Preserve an explicit format the humans already chose.

### Team rules

Record a stable team id, room-facing name, participant ids, and an optional captain.
A captain is a social role only. Captains may draft, name a team, or lead the trash
talk; they cannot opt in teammates, grant data, or change another person's sharing.

Every `in` participant belongs to exactly one team. Freeze team membership at
kickoff. A later move is an explicit dated ruling that applies prospectively and
never rewrites an already published score.

For team `sum`, a partial team total is a verified subtotal. For team `average`, do
not publish a comparison-safe average until every included participant has complete
component coverage; missing people can move an average in either direction.

### Collective rules

A collective challenge has a points target. Lead updates with:

- verified points so far;
- percentage of target;
- points remaining from the verified total;
- whether coverage is complete;
- pace or the next milestone when useful.

Individual contributions may be included when the room wants them, but do not let
the default presentation quietly turn the cooperative game into a leaderboard.
Never manufacture an individual loser or blame one person when the group misses.

## Additive components

A scorecard has one to five components. Five is a hard ceiling, not a target. Prefer
one to three unless each additional component materially improves the game.

For each component, freeze and record:

1. **id and label** — stable id plus the words the room will see;
2. **exact projection scopes** — deduplicated with the other components;
3. **evaluation rule** — how current eligible records become a non-negative integer
   quantity;
4. **quantity unit** — steps, grams, meters, qualifying days, workouts, basis points,
   or another explicit integer unit;
5. **point rate** — `points` per `perQuantity`;
6. **optional cap** — maximum points for the component over the stated period.

Scoring is additive and non-negative:

```text
component points = floor(quantity × points / perQuantity)
participant points = sum(component points)
```

Normalize decimals before arithmetic. Use meters instead of fractional kilometers,
integer grams where the records support them, or another named integer base unit.
Do not repeatedly round daily values when the rule is a whole-window total; aggregate
the quantity first, then apply the frozen rate once.

V1 has no arbitrary code, negative points, multipliers, nested expressions,
cross-component bonuses, or hidden formulas. Most rules that sound more complex can
still normalize to a simple quantity: number of qualifying workouts, number of days
meeting a threshold, total distance, or integer baseline-improvement basis points.

## Point-balance preview

Before the final roll call, test the weights against one ordinary reference day or
week and say when one component is likely to decide the challenge by itself. Keep it
brief and concrete.

Example semantic shape:

> At these rates, the protein component is worth about twice Steps plus a late
> workout on a normal day. Keep it intentionally protein-heavy?

The group may choose a lopsided game. Your job is to make the consequence visible,
not optimize the scorecard for them.

When unlimited volume could create a bad exercise, nutrition, sleep, or recovery
incentive, propose a daily or whole-window cap. A cap is a game mechanic, not a health
prescription.

## Exact scopes and current transport bound

Request the deduplicated exact scopes required by every component in the scoring
read. One scope may legitimately support several components; never request it twice.
Do not request unrelated diagnostic data in that read.

The product contract supports five components and targets five distinct scoring
scopes. Until the hosted `read_shared` contract, parser, runtime, and tool schema all
move together from three to five, do not configure a live scorecard that exceeds the
current runtime's accepted number of distinct scopes. Five components may still run
when some reuse the same scope.

Permission evidence remains latest-read-only:

1. Read all scoring scopes first.
2. If any scoring scope is `not_granted`, handle the exact eligible scoring offer
   from that read before doing diagnostics.
3. Only when every scoring scope is granted but usable data is genuinely missing may
   you make the second diagnostic-only `device-sync-status.v0` read.
4. Never let a later diagnostic read erase the evidence needed for a scoring-scope
   offer.

## Interpreting common component shapes

Use the exact projection semantics from `group-challenge`; these are examples of
normalization, not a closed catalog:

- Steps: total eligible `steps-days.v0` values.
- Logged protein: total eligible grams from `protein-days.v0`; always say **logged
  protein**, never verified consumption.
- Workout after a fixed local time: count settled `workouts.v0` entries whose
  `startLocalMs` satisfies the frozen strict or inclusive threshold.
- Activity distance: total meters from the exact selector-scoped activity-distance
  projection.
- Successful days: count eligible days whose observed value satisfies the frozen
  threshold.
- Baseline improvement: compute the frozen absolute or percent delta, normalize it to
  explicit integer units, and keep the baseline dates on the page.

For a phrase such as "after 9 PM," normalize the threshold once to milliseconds after
local midnight. Record both the human wording and integer threshold. Do not move it
later because a participant changes time zone or because the standings become
inconvenient.

## Component evidence and coverage

Classify each `in` participant separately for every component:

- `available` — compute and award from current eligible evidence;
- `pending` — keep the component unawarded until its producer-owned completion rule
  settles it;
- `missing` — the share is granted but no usable current record exists;
- `not_granted` — the exact required scope is not shared;
- observed zero — available evidence proving a real zero quantity and zero points.

Missing, pending, and not-granted components award no **verified** points yet, but do
not become measured zeroes. Because all rates are non-negative, available components
form a verified lower-bound score. Describe it that way whenever coverage is partial.

Lead every update with aggregate completeness for the chosen format, then separate
scored results from named component/data statuses. Do not make the group decode a
single opaque "partial" label when one concise component label explains what is
pending.

## Durable challenge-page shape

Keep the base challenge page as the sole owner. Add or replace these mechanical
sections; do not create another state system:

- **Format & objective** — individual, teams, or collective; ranking or target.
- **Scorecard & exact rules** — ordered components, projection scopes, evaluation
  rules, quantity units, rates, caps, rounding, and a rules revision.
- **Window & publishing** — scoring dates, grace period, dispatch cadence, milestones.
- **Roster & teams** — normal participation state plus frozen team membership.
- **Baselines** — only for components that need them.
- **Scoreboard snapshots** — participant component quantities and points, aggregate
  scores, coverage, and the published ruling.

The human-readable page is the authority until a dedicated managed scorecard block is
wired. Recalculate from the frozen rule, never from remembered totals. In the same
turn as any rule change, append a dated amendment and state that it applies
prospectively. Never silently change weights, thresholds, caps, rounding, or teams
after seeing results.

## Scheduling and long-running games

Use the one challenge automation owned by `group-challenge`. It may run daily to
settle the rolling shared window while publishing less often:

- daily for a short friend challenge;
- weekly plus meaningful milestones for a long collective target;
- no reply on an ordinary settlement day with nothing worth publishing.

Do not create separate capture and publishing automations. For a challenge longer
than the available projection window, persist dated settled snapshots or compact
cumulative quantities before old source records roll out. Never add the same settled
date twice.

Until idempotent long-running accumulation is fully wired and verified, do not claim
that an annual automatic challenge is production-safe. A short challenge using the
current rolling records is in-bounds.

## Format-specific close-out

- **Individual ranking:** declare the winner and any agreed safe placement-based
  stakes.
- **Team ranking:** declare the team result first; individual contribution detail is
  secondary unless the room asks.
- **Individual or team target:** say who reached the target and settle only the
  agreed payoff.
- **Collective:** say whether the group reached the target, what it accomplished,
  and trigger the shared celebration, beneficiary callback, or honest near-miss
  recap. There is no loser by default.

Every close-out uses fresh shared evidence plus the page's settled snapshots, carries
coverage truthfully, and preserves the base skill's privacy and protected-register
rules.
