# Personal Patterns

Last verified: 2026-08-10

## Product boundary

Personal Patterns finds repeated links between a member's action and next-day
sleep or recovery. It produces a private clue, not a causal claim, diagnosis,
recommendation, or score of the member's behavior.

The result can appear in Overview and can support the existing Weekly health
insight. The weekly automation still sends zero or one message. It must inspect
source dates, source health, plausible confounders, and recent insights before
it sends anything.

## History and refresh

The query reads the member's existing canonical history. It does not start a
new collection window when the feature ships.

- The default lookback is 120 days ending on the report date.
- Existing members can receive a result from data that predates deployment.
- Overview reads a derived report from the encrypted Browser Vault replica.
- An older replica has no Personal Patterns field and reads as an empty report.
- On the member's next runtime execution, the hosted runtime rebuilds a replica
  after source data changes or after its normal 24-hour maximum age is exceeded.
- A code deployment alone does not force every inactive member's replica to
  rebuild immediately.
- The Weekly health insight reads the query through `vault-cli` and does not
  depend on the browser replica.

## Inputs and comparison

Eligible factors come from completed activity and intervention sessions.
Missed and skipped intervention sessions do not count.

Names that describe an outcome rather than an action are not eligible factors.
This includes sleep, sleep score, sleep efficiency, HRV, resting heart rate,
recovery score, and readiness score names. This avoids formula-like or
same-family comparisons.

For each factor day, the query reads the next day's outcome. It then finds the
nearest unused comparison day that:

1. does not contain that factor;
2. has the same weekday;
3. is no more than 35 days away; and
4. has the same next-day outcome available.

One comparison day can support only one pair for a factor and outcome.

## Evidence stages

A cell needs at least five matched pairs across at least 21 days. Before that,
its stage is `insufficient` and it does not make its factor or outcome visible.

A tested cell is `no_clear_pattern` when its difference is too small or its
direction does not repeat in both halves of the history.

The remaining stages are:

| Stage | Minimum pairs | Minimum span | Other rule |
| --- | ---: | ---: | --- |
| `new_clue` | 5 | 21 days | Meaningful difference and the same direction in both halves |
| `seen_again` | 8 | 42 days | Same rules with more repeated history |
| `worth_testing` | 12 | 56 days | Difference is at least 1.5 times the meaningful threshold |

These stages express repeated evidence. They do not express statistical proof.

## Meaningful difference thresholds

The query uses the larger of the absolute and relative threshold.

| Outcome | Absolute threshold | Relative threshold |
| --- | ---: | ---: |
| Total sleep | 15 minutes | 3% |
| Sleep score | 3 points | 3% |
| Sleep efficiency | 2 percentage points | 2% |
| Recovery score | 3 points | 3% |
| Readiness score | 3 points | 3% |
| HRV | 2 ms | 5% |
| Resting heart rate | 2 bpm | 3% |

These values are V1 product policy. Calibrate them with aggregate,
privacy-safe operational evidence before changing them. Do not expose a member
setting for these thresholds until a clear product need exists.

## Presentation

Overview shows only factors and outcomes with at least one tested cell. It can
show at most six factors and seven outcomes. The matrix preserves tested flat
results because "no clear pattern" is useful evidence.

Do not add a fixed smaller cap until real usage shows that the matrix is too
dense. If that happens, prefer a deterministic read-time ranking over new
stored state or member configuration.

## Ownership

`@murphai/query` owns the calculation. Browser Vault stores only the derived
report. Overview presents that report. `vault-cli` exposes the same query to
the assistant runtime. The existing Weekly health insight owns message timing
and deduplication.

Do not add a database table, API, cron, dependency, statistical service, or
second calculation in React or an assistant prompt for this feature.
