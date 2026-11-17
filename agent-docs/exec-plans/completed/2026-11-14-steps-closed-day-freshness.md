# Count a finished day's steps from a device only when it reported after the day ended

Status: completed
Created: 2026-11-14
Updated: 2026-11-14

## Goal

Daily steps come from a worn device's own total when it is at least half of the
merged health-store total (#4606). That rule compared values only. A device
total last updated mid-afternoon kept beating the phone's later total, including
after the day had finished. The owner approved one addition: for a finished
local day, a device total counts only if it was recorded at or after that day's
end; otherwise the merged total stands. A day still open keeps the rule as it is.

## Product UX

Outcome: a finished day shows the fuller count when the device stopped
reporting partway through it, and returns to the device's own total as soon as
the device reports that day again.
Reaches: members with a watch or ring and a merged health store on the same day.
Each source's own number, group boards and days with one source are unchanged.
Proof: synthetic records through the Junction importer, the stored projection
and the day's metric point.

## Scope

- In scope: the shared steps rule in `packages/query/src/wearables`, the stored
  activity evidence that lets stored rows re-rank the same way, and three
  departures from the owner's rule an audit listed.
- Out of scope: the 8-hour settle on the numbers page and the board, group
  boards (one source at a time), sleep and resting heart rate selection.

## Decisions

1. **The vault's own steps totals say when a day is finished, not a clock.**
   Steps selections are computed at read time for assistant reads and at build
   time for the day's metric point and the saved numbers. A clock would give two
   answers for the same records. The day is finished once any steps total, from
   any source, was recorded at or after that day's end. With none, nothing newer
   exists to show, and the rule stays as it was. Review found that "any wearable
   record" was too wide: an overnight summary is stored at noon UTC on its wake
   date, which in UTC+12 and beyond is after the same local day ends, so it
   finished a day that had just begun. Steps totals carry the provider's own
   update time, the same time the rule already trusts for the device total.
2. **The record's own zone decides its day end.** Its IANA zone when it names
   one, so a 23- or 25-hour day ends on time, else its UTC offset, which also
   stands in on a date that zone's midnight is skipped or repeated. A record
   with neither keeps the half rule alone.
3. **Collection decides, the policy applies.** Collection sees every record
   before a provider or date filter narrows a read, and marks a total that is a
   partial count of a finished day. The mark is stored with the activity
   evidence because stored rows are re-ranked across sources at read time and
   carry no zone. Present only when true.
4. **Projection schema 40.** Stored evidence validates strictly. A version step
   rebuilds rows written before the mark and lets an older build rebuild rows
   written after it, so no reader meets a row it cannot parse.
5. **Nothing is dropped.** The device's partial total stays a candidate. It is
   still that source's number in source-filtered reads and on a day with no
   merged total. One source can hold both a worn and a merged total (Apple
   Health with an Apple Watch total); its own read and board series then follow
   the same rule.

## Departures from the owner's rule

- Fixed: a fresher sum of a store's intraday samples beat a device's daily
  total on a day the store sent no daily summary. A device total that counts now
  passes over such sums.
- Fixed: a device total of 0 fell through to the standard ranking, where the
  merged total won only through an unrelated +3 given to sources without a
  direct integration. With enough fresher candidates the 0 won. The merged total
  now stands by rule. This is the case to settle before any Apple Health catalog
  descriptor removes that +3.
- Left for a product decision: an Apple Health row tagged `watch` (an Apple
  Watch reading) gets that same +3 and so always beats another wearable for
  sleep and resting heart rate. Removing the +3 makes the later sync win, which
  is not clearly better. The choice is which device a member who wears both
  should see.

## Verification

- `packages/query`: unit cases for the rule, day ends across zones and both
  clock changes, and the finished-day test through records, stored rows and
  metric points.
- `packages/vault-usecases`: Junction-shaped activity rows through the importer
  and core into a vault, then the three reads.
- Package suites, typecheck, `pnpm complexity:diff`, `pnpm test:diff`.
Completed: 2026-11-14
