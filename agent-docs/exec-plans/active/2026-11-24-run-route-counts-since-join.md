# Run route counts runs from the join day

Status: revised after ReviewGPT (architecture, mountain lane, Nov 24), building.
Owner approved the product change on Nov 24 (Paper, "Run route · before and
after"): Run's route counts runs from the day the member joined, the same
rule as the Steps walking route. Medals already won and routes already
finished stay.

## Today

- `readOwnSeries` (vault-runs.ts) merges `state.vaultRuns.days` into
  `run.meters`: each day is the larger of game check-ins and imported runs.
  Imported runs reach back before joining.
- Steps sums start at the raw join day, `toLocalDayKey(createdAt, timeZone)`
  (health-reader.ts), not the Oct 1 chart floor.
- Route legs: leg 0 has `startTotal: 0` and starts on the series' first day. A
  later leg saves `startTotal` = the series total when picked. Medal keys
  include `startTotal`; medals insert with skipDuplicates.

## Design

One saved field and one reader. No saved route start is ever rewritten.

1. `MeasureState.runsFrom?: Day` on `run.meters`. When set, `readOwnSeries`
   merges only imported days on or after it. When absent, it merges every
   imported day, exactly as today.
2. `countRunsFromJoin` sets `runsFrom` to the raw join day once, from the
   Progress read, and only when the change cannot move a saved start. Running
   must exist (a measure or a state), and one of these holds:
   - Running has no route yet.
   - Running is on its first route (one leg, `startTotal` 0, no `startedOn`),
     the route has no medal, and the current total hasn't reached its end.

   The patch re-checks that the saved legs are the ones it judged and that the
   field is still absent. A state conflict is not an error: the read goes on
   unchanged and a later read tries again. After a successful write, the
   Progress read re-reads the series so this response, its medals and the
   route all use the since-join runs.
3. When imported runs exist but health access is off, skip: their total
   can't be judged.
4. Everyone else keeps counting every run: a member already past their first
   run route, or one whose first route is finished or crossed. Their saved
   starts were taken from all-time totals and stay true. This is the only gap
   from the approved mock. The route a member is on drops pre-join runs only
   when it is their first run route.

## ReviewGPT findings (architecture round 1) and outcome

1. **P1, today's imports can't establish a legacy start's imported part:
   accepted.** The design no longer subtracts anything from a saved start.
   Legacy later legs are grandfathered, not rebased.
2. **P1, deploy skew with ordinary Progress reads: accepted, mostly
   dissolved.** No since-join start is ever saved under the old meaning.
   - The only new state is `runsFrom`. An old reader ignores it and computes
     today's all-time series against unchanged starts, which is today's
     production behavior.
   - The one residue: during the rollout, an old instance could award a first
     route that the all-time total completes, after a new instance set
     `runsFrom`. A read a minute before deploy would have awarded the same
     medal. It's accepted and noted, with no cutover.
3. **P2, series and route state must agree at every consumer: accepted.**
   - `readOwnSeries` is the single place that applies `runsFrom`, so map,
     pics, goals and Progress see the same basis.
   - Before the field is set, every consumer is on the old basis, and the old
     starts match it.
   - The patch re-checks the legs it judged, and a CAS conflict is swallowed,
     not surfaced.
   - `setFirstRoute` and `replaceRouteLeg` are unchanged. A leg made while the
     field is set is on the new basis. A leg made before it is set either
     qualifies for the switch (`startTotal` 0) or stays grandfathered.
4. **P2, `vaultRunsMerged` must not double as migration input: accepted.**
   The switch reads the saved imported days and health access directly.
   `vaultRunsMerged` keeps its existing meaning.
5. **P2, finished-route presentation after the cutoff: avoided.** A finished,
   medalled or crossed first route never takes `runsFrom`. The only way to see
   that presentation is the skew residue in 2.

## Tests

- `readOwnSeries` with `runsFrom`: imported days before it are left out; days
  on or after it still merge. Without it, everything merges as today.
- `countRunsFromJoin`:
  - It stamps a state with no legs, and one with an unfinished first leg.
  - It skips a later leg, a medalled first leg, a crossed but unmedalled first
    leg, and a state already stamped.
  - It skips imported runs without health access, and legs that changed
    before the write.
  - A state conflict returns false and doesn't throw.
