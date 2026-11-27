# Private You views

The seven gated GET handlers under `health/you` serve the authenticated member. The TypeScript engine uses the frozen r3.0 mortality-equivalent age comparison. The precise estimate includes an interval for missing-panel spread. A probability is available in the research parity interface only.

## Dated inputs

The reader loads the published core, metric index, requested metric buckets and lab shard. Required read failures produce unavailable or a previously sealed, matching stale view. Optional fields on older publications remain unknown.

| Input | Replica evidence and limits |
| --- | --- |
| Demographics | Reference sex and birth year from canonical demographics. The internal age anchor uses July 1 with an explicit approximation flag. The member’s join date and the vault time zone bound replay. The private headline requires an unambiguous eligibility year. |
| Sleep, pulse, steps and VO₂ | Same-provider and same-method daily sleep minutes and resting pulse. Positive watch steps with unknown wear can supply reduced, favorable-only credit. Full wear enables the two-sided comparison. Phone and unqualified relay sources supply no wearable credit. A device VO₂ estimate needs two dates from the same supported watch. Daily sleep and pulse need seven observations within nine days and a fresh reading. HRV, sleep stages, vendor scores, distance and floors supply context. Stable original device attribution, explicit wear and effort-qualified intensity are only usable where projected. |
| Bedtime | The optional nightly start, end and local zone support the bedtime target using a fourteen-night personal baseline. Sleep regularity index and the least-active five-hour midpoint require additional signals. |
| Workouts | The 62-day session projection supplies dated types and durations. Completed strength training with a duration also comes from the 183-day training projection. The generic session projection folds some types into “other.” R3 takes the longest session of a type on each date and applies its 28-day duration, span and freshness rules. Running takes priority over lifting. A qualifying volume stream takes priority over both. |
| Body | Dated height, weight, BMI, waist and body fat. Pair weight with an eligible height known at the time. Direct BMI is a fallback. Body fat remains descriptive. |
| Blood and urine | Normalized results, catalog units, comparator, pending status and identified draw. Same-draw total and HDL cholesterol can establish non-HDL. Lp(a) needs mass units. The publication does not carry a complete history of result revisions, retractions or release timestamps. The normal 365-day read bounds long-lived markers too. |
| Blood pressure | Canonical upper/lower components share one measurement ID and timestamp. Event-grain relay readings require matching source, timestamp and setting. The office route needs paired readings on two days. Validated home readings need morning and evening pairs on three days. The current paired home check-in does not attest cuff validation. |
| Combine | Canonical version-one assessments supply protocol, session, date, station, variant and reported performance. Floor rise and a completed ten-second stance can receive reduced weight. The current grip station carries one result without separate left/right maxima. Skipped stations supply no score. |
| Food | A submitted version-one food week supplies its portion answers and eating days. R3 uses only matched foods, at reduced quality, for up to 42 days. One week of alcohol is descriptive. The replica meal summary cannot certify seven complete days of quantified fibre. |
| Other check-ins | The current one-off instrument publishes the WHOOP zone answer. The model accepts dated smoking and quit history, habitual alcohol, diagnosed diabetes, serious conditions, self-rated health and qualified tests when matching typed inputs exist. The current instrument does not publish those fields. Core demographics also lack clinical eligibility, medication and mobility flags. |

## Views and history

Unsupported profiles pause. A reference-only profile, an out-of-range equivalent age, an ambiguous eligibility year, or a single proxy or published factor without independent corroboration yields a building headline. Observed factors carry their frozen definition and interpretation. Raw-value percentiles are descriptive.

Each historical point uses dated evidence available by the evaluation day. Comparable factor changes at fixed chronological age determine weekly modeled days. A reference-only week shows 7.0 days, carries a partial flag and has empty helped and cost lists. Age events with kind `evidenceChange` carry the remaining change in years over the preceding week. They can include changed coverage, reference age or new measurements. An event does not assign that entire change to a lab draw or workout.

One sealed row per member holds the view bundle. Its dependency binds the member, model and schema versions, immutable publication, data version, local date and zone. Conditional publication protects against stale writers. The next replica publication makes canonical check-ins visible. Private read authority is checked before and after serving the response. Game and working-on rows remain outside the cache.

## Reproduction

Run `python3 -B apps/web/scripts/health-you/reference.py <R3-directory>` to import the frozen aggregates and all 120 invented research cases with history. The colocated parity suite compares complete outputs. The research Node verifier accepts an ES module exporting `fromRaw` from the same engine. Run `pnpm exec tsx apps/web/scripts/health-you/views.ts` to regenerate the six synthetic main states and six companion details in `apps/web/test/fixtures/health-you/goldens/`.
