---
name: group-challenge-scorecards
description: |
  Format and scorecard extension for group-challenge. Read alongside group-challenge
  whenever a challenge uses teams, a shared target, multiple metrics, weighted
  points, or a long-running cumulative group goal, and on every scheduled dispatch
  for such a challenge. Owns only format, component rules, point balance, aggregate
  scoring, bounded multi-scope reads, and format-specific presentation.
  Group-challenge still owns formation, buy-in, consent, the durable page,
  scheduling, diagnostics, and close-out.
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
become a health-metric query language, read health records, infer a rule, or own
challenge state.

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

1. **id and label** — stable kebab-case id plus the words the room will see;
2. **exact projection scopes** — deduplicated with the other components;
3. **evaluation rule** — how current eligible records become a non-negative integer
   quantity;
4. **quantity unit** — steps, grams, meters, qualifying days, workouts, basis points,
   or another explicit integer unit;
5. **point rate** — `points` per `perQuantity`;
6. **optional cap** — maximum points for the component over the stated period;
7. **settlement mode** — `window-total` or `daily-additive`.

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

> At these rates, the protein component is worth about twice Steps plus a late
> workout on a normal day. Keep it intentionally protein-heavy?

The group may choose a lopsided game. Your job is to make the consequence visible,
not optimize the scorecard for them. When unlimited volume could create a bad
exercise, nutrition, sleep, or recovery incentive, propose a daily or whole-window
cap. A cap is a game mechanic, not a health prescription.

## Exact scopes: compose bounded reads instead of widening the transport

The hosted shared-read boundary intentionally stays small. Deduplicate the exact
scoring scopes in scorecard order, then split them into stable batches of at most
`ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES` scopes — currently three.
Five components remain supported because one scope may support several components and
because several bounded reads may feed one scorecard.

Run scoring batches sequentially after the model turn begins:

1. Read the next scoring batch only; never mix diagnostics into it.
2. If any scope is `not_granted`, immediately handle the exact eligible permission
   offer from that read and stop before making another shared read. The latest read is
   the only permission evidence.
3. Otherwise retain only the normalized component evidence needed for scoring and
   continue to the next batch.
4. Every successful batch must return the same ordered set of current
   `participantId` values. If membership differs, do not combine snapshots or publish
   standings; record the run as unverified and try again on a later turn.
5. Only after every scoring batch is granted may a separate diagnostic-only
   `device-sync-status.v0` read investigate genuinely missing data.

This keeps the privacy/result-size bound intact and avoids a new multi-metric hosted
RPC. Never work around it with raw vault-share files or private 1:1 data.

## Normalize once, then call deterministic scoring

After all scoring batches are consistent, build one explicit observation for every
`in` participant crossed with every component:

- `available` with a non-negative integer `quantity`;
- `pending`;
- `missing`;
- `not_granted`.

Observed zero is `{ status: "available", quantity: 0 }`; it is never `missing`.
Only normalized quantities and statuses cross the arithmetic boundary. Never copy
raw shared records, provider payloads, dates that the score does not need, handles,
or display names into the scoring input.

Write the bounded JSON input to a temporary file, call:

```sh
vault-cli knowledge score-challenge --input @<temporary-json-path> --format json
```

Then remove the temporary file. The input shape is:

```json
{
  "format": { "kind": "individual", "objective": { "kind": "ranking" } },
  "scorecard": {
    "components": [
      {
        "id": "steps",
        "label": "Steps",
        "quantityUnit": "steps",
        "points": 30,
        "perQuantity": 1000
      }
    ]
  },
  "participants": [
    {
      "participantId": "opaque-group-participant-id",
      "components": [
        { "componentId": "steps", "status": "available", "quantity": 10000 }
      ]
    }
  ]
}
```

For teams, include frozen `teams`, `aggregation`, and optional captain ids under
`format`. For a target, use `{ "kind": "target", "targetPoints": N }`. The command
validates one-to-five components, explicit observations, team membership, safe integer
arithmetic, caps, coverage, and aggregation. A command failure means the normalized
input is invalid; fix the input or ruling rather than doing fallback arithmetic.

Persist the command result on the existing challenge page in the same turn before
composing the standings. The command does not write the page for you.

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

## Durable challenge-page state

The existing challenge knowledge page remains the sole durable owner. Do not add a
challenge database, Web score service, parallel score file, or second scheduler.
Keep these sections current:

- **Format & objective** — individual, teams, or collective; ranking or target.
- **Scorecard & exact rules** — ordered components, exact scopes, evaluation rules,
  units, rates, caps, settlement mode, rounding, and `rulesRevision`.
- **Window & publishing** — scoring dates, grace period, dispatch cadence, milestones.
- **Roster & teams** — participation state and frozen team membership.
- **Baselines** — only for components that need them.
- **Cumulative settlement** — bounded participant/component totals for long-running
  games.
- **Scoreboard snapshots** — the latest command input summary, command result,
  coverage, and published ruling.

Use `vault-cli knowledge upsert` when changing the managed state in an existing page;
append-only social facts may still use `append-section`. Write state in the same turn
as the evidence or ruling. Never silently change weights, thresholds, caps, rounding,
teams, settlement mode, or `rulesRevision` after seeing results.

## Long-running cumulative settlement

A short `window-total` component may be recomputed from the current shared window. A
challenge that can outlive that window is production-safe only when every long-running
component has an explicit `daily-additive` rule (or another source that exposes the
whole challenge history).

For each participant and daily-additive component, store this compact state on the
page:

```json
{
  "rulesRevision": 1,
  "settledThroughDate": "2026-07-28",
  "cumulativeQuantity": 12345,
  "skippedDates": []
}
```

On each daily automation run:

1. Read the page before shared data.
2. Consider only producer-settled dates after `settledThroughDate` and inside the
   frozen challenge window.
3. Add each date at most once, in order. An observed zero advances the watermark.
4. Do not advance across an absent or pending date. A permanently unavailable date
   moves to `skippedDates` only after an explicit dated ruling; skipping never implies
   zero.
5. Upsert the new cumulative quantities and watermark before publishing or finishing
   without reply.
6. Feed cumulative quantities — not the rolling source subtotal — into
   `score-challenge`.

The first settled value for a date owns the challenge ruling, matching the base
skill's immutable published-snapshot rule. Later imports may be noted as context but
do not silently rewrite cumulative competition history. A missed automation whose
source dates have already rolled out is unverified; never reconstruct it from memory.

This bounded watermark state supports annual automatic goals without retaining an
unbounded daily ledger or creating another persistence system.

## Scheduling and close-out

Use the one challenge automation owned by `group-challenge`. Run it daily when a
long-running component needs settlement, while publishing at the cadence the room
chose:

- daily for a short friend challenge;
- weekly plus meaningful milestones for a long collective target;
- no reply on an ordinary settlement day with nothing worth publishing.

Do not create separate capture and publishing automations.

At close-out, complete the final eligible settlement, run the same deterministic
score command, persist its result, and then apply the format:

- **Individual ranking:** declare the winner and agreed safe placement-based stakes.
- **Team ranking:** declare the team result first; individual detail is secondary.
- **Individual or team target:** say who reached the target and settle the payoff.
- **Collective:** say whether the group reached the target, what it accomplished, and
  trigger the shared celebration, beneficiary callback, or honest near-miss recap.
  There is no loser by default.

Every close-out uses fresh authorized evidence plus the page's cumulative settlement,
carries coverage truthfully, and preserves the base skill's privacy and
protected-register rules.
