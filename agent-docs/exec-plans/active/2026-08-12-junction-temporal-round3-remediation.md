# Junction temporal round-three remediation

Status: active
Created: 2026-08-12

## Outcome

Close the three production-path temporal-feature findings at the existing owner
boundaries, integrate the latest summary-only test correction, and return PR
#1703 to a truthful, bounded, verified head without retaining raw timeseries.

## Findings and decisions

1. The hosted importer wrapper must forward the existing optional vault-timezone
   resolver while preserving hosted artifact error translation. An importer that
   omits the resolver keeps ordinary ingestion but cannot mint temporal authority.
2. Generic account success is not temporal completion evidence. Every scheduled
   Junction reconcile processes at most the newest authoritative vault-local day
   for the two temporal resources; the existing generic completion optimization
   remains for non-temporal resources.
3. Exact-window filtering distinguishes absolute timestamps from floating or
   date-only values. Absolute values use UTC instant bounds. A complete authorized
   vault-local day admits floating/date-only values only when their raw local day
   matches that authority. Precise windows without day authority do not invent an
   instant.
4. Preserve the existing ten-observation cap on each resource/day
   normalization and document its composed maximum truthfully: the two temporal
   resources can admit at most twenty observations for one local day, while the
   current reducers emit at most six in total.
5. Integrate the exact latest summary head after authored remediation, then repair
   only test/budget deltas proven to belong to the merged current head.

## Work

- [x] Forward hosted timezone resolution and add real hosted non-UTC replacement proof.
- [x] Remove account-wide temporal starvation and prove bounded reconcile ordering.
- [x] Correct floating timestamp filtering and prove both timezone directions.
- [x] Enforce or truthfully document the temporal output cap.
- [ ] Merge the latest summary head and resolve current CI deltas.
- [ ] Run focused verification, archive this plan, commit, push, and update PR #1703.

## Verification

- Hosted runtime through the real default importer, including populated to empty
  replacement, base-fact preservation, resolver omission, and artifact failures.
- Junction resource-before-reconcile scheduling, repeated resource jobs, empty,
  failure, yield, and two-resource/one-day fanout.
- Real Junction client pagination/filter/import/core/query for absolute and
  floating boundaries in positive and negative IANA zones, including adjacent-day
  overlap and process-timezone independence.
- Affected package typechecks, focused CI reproductions, runner bundle budget
  policy and assembly, diff/privacy scans, exact-head ancestry, and merge-tree.
