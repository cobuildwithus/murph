# Health wins engine

`generateHealthWins(input)` returns up to 24 `CardSpec` objects for one member, newest achievement first.
Pass local calendar dates as `YYYY-MM-DD` and set `member.today` explicitly. Each
card carries its title, source note, filter, theme, and a chart typed by `kind`.
Titles and subtitles round for display. Numeric chart data retains its original precision.
Display A1c readings with one decimal and express changes in percentage points.
The hours option rounds duration labels to the nearest tenth of an hour.
The function runs in memory and leaves the supplied arrays untouched.

Chart data uses `YYYY-MM-DD` for days and `YYYY-MM` for months. Copy displays
dates as `Nov 6`, or `Nov 6, 2035` when the year differs from `member.today`.
A record's `highlight.label` and pill use that display format. Render trend pills verbatim in their supplied order.
The engine calculates distance trends in kilometres. The wins route presents them in
miles for US and UK requests and kilometres for metric requests. Selecting a trend
preserves its displayed units on the post.
Where an opaque card ID includes a full day, that component uses `YYYYMMDD`.

## Suggestion order

The engine selects up to 24 cards using the score and category rules below.
After optional Decisions ranking, the picker sorts the entire selection by achievement
day, newest first. Cards on the same day keep their prior rank. Filtering preserves
that order. The sort date stays on the server.

| Achievement | Day used for display order |
| --- | --- |
| Trend or best month | Last calendar day of the achievement month, capped at the member's current day for an ongoing month. |
| Daily or game streak | Last day of the streak. |
| Personal record | Day the record was set. |
| Percentile | Latest reading used in the comparison. For labs, this is the draw day. |
| Lab change or range | Day of the latest draw used for the card. |
| Cumulative distance, threshold count or monthly sessions | Last day counted in the total. |
| Game climb | Latest day contributing to the exercise total. An older summary with no contribution date uses its as-of day. |
| Experiment | Final day of the intervention. |

## Inputs that affect interpretation

- Daily values are whole-day observations. Provider aliases are normalized. Conflicting values from one provider on one date make that provider unavailable for that date.
- The default ranker uses the shared Progress norms. To supply another comparison, pass `rank(metric, value, context)`. Return `null` when the observation has no comparable cohort. Otherwise return `betterShare` (0–100), a short display citation for the cohort, the age/sex group, the percentile cutoffs for the chart, and whether lower values are better.
- RHR and steps use the 14-day mean when at least 10 days were observed. With less coverage, RHR can use the current calendar month's mean from at least 14 observed days. The source note identifies the period. The member's wearable and every selected RHR day in that period must support the same measurement method. A generic Apple Health import has unknown device provenance. VO2 max uses the latest estimate.
- Lab percentiles use the draw's unit and the matched row's direction. The default comparisons use p5 through p95. Favorable values past the outer supported cut read “Top 5%.” LDL, triglycerides and insulin accept fasting draws and draws with unknown fasting status. The source note identifies an unknown status. Glucose has no comparison cohort. [Lab reference sources and method](../../game/progress/lab-norms.md)
- For a range card, pass the reporting lab's inclusive `referenceRange` in the draw's unit, or an eligible `specimen` for a reviewed comparator. A `normal` flag alone supplies no numeric bounds. When fasting status is known for any comparable triglyceride or glucose draw, the latest and at least two prior draws must be explicitly fasting for a change card.
- Mark private interventions with `experiment.sensitiveCategory`, including experiments that measure an allowed outcome such as sleep. The caller owns this classification for free-text titles. A private overlapping intervention also withholds the concurrent readout.
- The game adapter supplies `gameStreak.calendar` with the member's per-date outcomes across all scheduled games, including unclassified exercises. The engine fills dates without an outcome with `no_game` and orders `chart.calendar` in whole Monday–Sunday weeks. Callers that omit `gameStreak` can still supply per-exercise `bestStreak` summaries. Summaries without daily evidence show the streak length and dates.
- Skyline entries in `landmarksPassed` and `next` carry a display `name` from the Progress height bank and `heightUnit: "ft"`. An unknown ID gets the display name `Landmark`.

## Rules and synthetic regression tests

| Rule | Behavior | Test file and case or suite |
| --- | --- | --- |
| 1 | Choose one provider per metric and day. A recorded zero occupies its day. | [daily-clean.test.ts](daily-clean.test.ts) · selects one provider, keeps one whole steps total |
| 2 | Apply inclusive hard bounds before selecting a valid day. | [daily-clean.test.ts](daily-clean.test.ts) · includes the limits |
| 3 | Compare each physiological reading with observations up to 45 calendar days before and after it. Drop readings more than six median absolute deviations from that window's median. With zero deviation only the median survives. Activity volume retains valid peaks. | [daily-clean.test.ts](daily-clean.test.ts) · preserves a sustained rise, trims an isolated long night |
| 4 | Exclude nights under three hours from the count denominator and chart. A missing night interrupts a consecutive run. | [daily-achievements.test.ts](daily-achievements.test.ts) · omits partial nights |
| 5 | Monthly means need 15 days in a completed month or 14 in the current month. Source notes give the coverage. | [daily.test.ts](daily.test.ts) · requires 15 days, labels partial coverage |
| 6 | Compare the current mean with the median of the previous three calendar-month means. Require a full favorable metric step. The title subtracts the two values displayed in the pills. | [daily.test.ts](daily.test.ts) · trend_change |
| 7 | Count eight-hour nights with at least 10 measured nights and 60% passing. | [daily-achievements.test.ts](daily-achievements.test.ts) · threshold_count |
| 8 | Choose the longest run in the last 90 days. It needs five consecutive passing dates and must end within 60 days. | [daily-achievements.test.ts](daily-achievements.test.ts) · streak |
| 9 | Compare monthly averages across six or more qualifying months. Use the current calendar year when it has enough observations, otherwise use the last 12 calendar months. Name the period and label ties. | [daily.test.ts](daily.test.ts) · best_month |
| 10 | A personal record requires 28 tracked days for its metric. Compare deep sleep, low RHR, HRV and steps within the current year when it has enough days, otherwise within the past 12 months. The record must be recent (within 60 days). Distance records use the current calendar year and can come from any day in it. | [daily-achievements.test.ts](daily-achievements.test.ts) · personal_record |
| 11 | Sum year-to-date walking and running miles. After six qualifying months this year, offer the highest qualifying monthly total if it also matches or exceeds every recorded monthly total, including partial months. | [daily.test.ts](daily.test.ts) · monthly and cumulative distance |
| 12 | Offer a percentile card when the member outperforms at least 70% of their age/sex band. Label the top share as a whole percent, rounding a fraction up. A 74% better share reads “Top 26%.” | [percentiles.test.ts](percentiles.test.ts) · offer boundary and exact labels, [default-rank.test.ts](default-rank.test.ts) · wearable and lab comparisons, [labs.test.ts](labs.test.ts) · range fallback |
| 13 | Compare like draws to the median of at least two eligible prior dates. Require an analyte-specific favorable step. Withhold flagged latest results. A single in-range draw can supply a gauge. | [labs.test.ts](labs.test.ts) · lab draws |
| 14 | Headline the completed intervention. Running blocks use the logged run count and the inclusive intervention length. The bars show the original means. Changes below the metric step read “about the same.” RHR and sleep score use a step of two, and sleep efficiency uses one percentage point. Withhold unfavorable changes that reach the step. Report adherence and overlapping interventions. | [activities.test.ts](activities.test.ts) · finished experiments |
| 15 | Name the highest passed skyline landmark from the Progress bank. Timed planks use the Progress plank ladder with passed rungs, the next rung and seconds to go. A best streak covers posting in every game and appears once. | [activities.test.ts](activities.test.ts) · game achievements |
| 16 | Once three sessions of one type qualify in the current month, show their count, total time and longest session. | [activities.test.ts](activities.test.ts) · monthly sessions |
| 17 | Exclude medications, genetics, conditions and weight, including private experiment overlaps. | [engine.test.ts](engine.test.ts) · admits only supported measures, [activities.test.ts](activities.test.ts) · withholds sensitive experiment topics |
| 18 | Select up to 12 cards with up to three per filter, prioritizing daily trends, threshold counts, streaks, monthly bests and personal records in that order within a filter. A trend supersedes a best-month claim about the same monthly mean. Distance's best month uses the monthly total. Fill the remaining slots by score until the catalog reaches 24. Score uses effect divided by noise, plus recency decreasing from 1 to 0 over a year, plus 1 for a personal record. Card ID breaks score ties. | [engine.test.ts](engine.test.ts) · distinct daily claims, score, category balance, crowded selection, conflicting snapshots |

Audit findings 1–2 exercise rule 6, 3 exercises rules 1 and 10, 4 exercises rules 3 and 11, 5 exercises rule 10, and 6 exercises rules 4 and 8. Findings 7–9 exercise rule 12, 10 and 12 exercise rule 13, and 11 exercises rule 14.

Run the focused suite with `pnpm --dir apps/web exec vitest run src/lib/health-wins`.

[cards.golden.json](fixtures/cards.golden.json) contains one synthetic example of
each engine card kind, including both the skyline and plank-ladder charts.
The golden test reads this file during normal runs. To regenerate it, run
`UPDATE_HEALTH_WINS_GOLDEN=1 pnpm --dir apps/web exec vitest run src/lib/health-wins/engine/cards.golden.test.ts`.
