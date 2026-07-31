---
name: group-challenge-scorecards
description: |
  Public arithmetic, scope, missing-data, and settlement contract for team,
  collective-target, weighted, multi-metric, and cumulative group challenge
  scorecards. Read alongside group-challenge when one of those formats is used.
  Hosted Murph replaces this baseline with its complete first-party presentation
  behavior during the private runner build.
---

<!-- murph-public-group-skill-baseline:v1 -->

# Group Challenge Scorecard Contract Baseline

This skill extends `group-challenge` only for scorecard format and arithmetic.
`group-challenge` still owns formation, opt-in, consent, scope offers, durable
challenge state, scheduling, diagnostics, safety, and close-out.

## Supported formats

Use exactly one declared format:

- individual: each opted-in participant has their own score;
- team: each opted-in participant belongs to one recorded team and the team score
  is derived from its declared member aggregation;
- collective target: the group contributes toward one recorded shared target;
- multi-component: up to five additive components use explicit weights and units;
- cumulative goal: the score advances over the recorded challenge window without
  resetting except where the canonical rules explicitly say so.

Do not infer a team, silently rebalance team size, create a hidden handicap, or
switch formats after data arrives. Any accepted format or weight change must be
persisted before it affects scoring.

## Component contract

A scorecard has at most five components. Each component records:

- a stable component id and human-readable label;
- one exact public `group-challenge` scoring scope, including any selector;
- the unit and aggregation operation;
- the point conversion or target contribution rule;
- its nonnegative explicit weight when weights are used;
- the challenge date window and any completion watermark rule;
- whether a real observed zero contributes zero points or another explicitly
  agreed value.

Point conversions must be deterministic and visible in the canonical challenge
page. Never invent a conversion after seeing standings, hide a denominator,
clamp a result unless the rules define the clamp, or award points from a metric
that was not requested and granted.

For a rule such as 30 points per 1,000 steps, compute complete units exactly as
recorded by the agreed rule. Do not change between floor, round, and fractional
scoring. For a fixed achievement such as a qualifying late workout, award the
recorded fixed points at most once per qualifying event or day, according to the
persisted rule.

## Read and identity boundaries

Use only current `read_shared` results authorized under `group-challenge`.
Attribute every value by exact group-scoped `participantId`, then map that id to
the canonical challenge participant and team. Display names, handles, member
order, previous standings, and remembered room context are never score joins.

Request only scopes needed by the declared components. A scorecard read that is
too large, partial, missing, or unavailable does not authorize an alternate
private read or a smaller roster chosen by the model.

## Missing, provisional, and zero data

Apply the public `group-challenge` date and completion semantics before any point
calculation.

- Missing, omitted, partial, pending, and provisional data are unscored, never
  zero.
- A returned settled numeric zero is real data.
- A participant with no usable value is named as missing rather than placed last.
- A team total excludes missing contributions only when the canonical aggregation
  rule explicitly permits partial-team scoring; otherwise the team result stays
  pending or incomplete.
- A collective target may show a verified subtotal while clearly identifying
  missing contributors, but it must not be called complete or failed from an
  incomplete data set.

Never compare unlike date sets as a settled ranking. When coverage differs,
report scoped values or an unranked pattern.

## Balance preview and rule edits

Before kickoff, show enough sample math to reveal whether one component can
overwhelm the rest. The preview is advisory, not observed participant data. The
room may edit weights or targets before accepting the scorecard. After kickoff,
changes require explicit group agreement and a durable rule revision; do not
retrofit weights merely because one metric dominates.

## Settlement

Recompute the final score from current settled authorized facts and the latest
canonical rules. Persist the component results, aggregate totals, missing-data
state, and tie result before announcing a winner or completion. Never settle a
format-specific result from remembered chat text or an earlier dispatch.
