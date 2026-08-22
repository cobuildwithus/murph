# Personal Patterns

Last verified: 2026-08-11

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
- An older replica has no Personal Patterns field. The web keeps that state
  separate from a calculated empty report and shows preparation while an
  automatic refresh remains pending.
- The shared Browser Vault projection generation advances when a new projection
  makes an otherwise current replica incomplete. The next authenticated
  dashboard session marks the older generation stale and schedules the existing
  low-priority refresh through the runtime mailbox and Temporal workflow.
- The browser checks quickly for 20 seconds, then every 15 seconds while the
  refresh remains pending. A delayed or initially failed refresh can therefore
  complete on the open page without a health-data change or manual action.
- A generation advance does not rebuild every inactive member at deploy time.
  It refreshes each member when their next authenticated dashboard session uses
  the existing Browser Vault path.
- The Weekly health insight reads the query through `vault-cli` and does not
  depend on the browser replica.

## Inputs and comparison

Eligible factors come from completed activity and intervention sessions, plus
one narrow query-owned wearable-tag rule. A neutral Junction wearable-tag note
counts only when its canonical note type, external reference, and data origin all
prove Oura, and only the exact product-owned `sauna` tag is admitted. The same
tag from another Junction source, unknown/custom Oura tags, and symptom, context,
or outcome tags remain neutral notes. Legacy Junction `tag-*` intervention rows
are excluded from factor derivation. Junction note-history policy generation 2
introduced one bounded semantic reimport for sources covered by the legacy
normalizer so neutral replacement notes restore eligible Oura sauna history
without rewriting old event kinds. The current generation 3 retains those
semantics while reopening the fixed 180-day initial-history obligation. Missed
and skipped intervention sessions do not count.

Activity days use the existing canonical activity-evidence date. Intervention
days use the existing scheduled/session local date before the generic event
date. Eligible Oura sauna notes use their canonical provider date. This keeps
retroactively logged sessions on their intended day without assigning action
semantics in canonical storage.

Sleep outcomes use the sleep-analysis date and eligibility policy. Explicit
naps do not count as next-day sleep outcomes.

Recovery outcomes first use the canonical wearable summary. When a provider's
normalized recovery values exist only as metric samples, the query uses the
same canonical metric-selection policy in Browser Vault and `vault-cli`.

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

`@murphai/query` owns the calculation and canonical metric selection. Browser
Vault stores only the derived report. Overview presents that report. `vault-cli`
exposes the same query to the assistant runtime. The existing Weekly health
insight owns message timing and deduplication.

Do not add a database table, API, cron, dependency, statistical service, or
second calculation in React or an assistant prompt for this feature.
