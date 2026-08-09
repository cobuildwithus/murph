# Biomarker derived display status

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

When a laboratory report omits a result flag, show a useful `In range`, `Above
range`, or `Below range` presentation when Murph has enough exact numeric
context to do so, without changing the imported laboratory record.

## Authority order

The presentation resolver applies one stable order:

1. preserve an explicit reporting-laboratory flag;
2. otherwise classify an exact numeric result against the reporting
   laboratory's safely normalized numeric range;
3. otherwise, only when the source supplied no range, classify against an
   exact-unit and eligible-specimen reviewed comparator;
4. otherwise remain neutral as `Reported`.

Qualified or unnormalizable source range wording blocks the generic comparator.
Comparator-valued results such as `<10` remain neutral because they do not
identify one exact point. The browser-replica rows and canonical blood-test event
remain unchanged; selectors derive status on presentation clones only.

## Shared architecture

`packages/health-metrics/src/lab-reference-ranges.ts` owns the small runtime
catalog used by both the Health Commons projection and the browser biomarker
selectors. It carries exact bounds, units, eligible specimen kinds, source
metadata, applicability language, and explicit status semantics. Health Commons
continues to expose source-free display ranges to Web routes, while Query reuses
the same catalog to derive presentation flags. This avoids a second Web-only
number table and keeps the list, filters, result header, and history ledger on
one status resolver.

Eight page-authored serum comparators remain authored in Health Commons content.
The runtime catalog mirrors those eight for status resolution but never exposes
those mirrors as duplicate display ranges.

## Coverage

The reviewed runtime catalog covers 33 canonical biomarker identities through
36 exact-unit records:

- eight page-authored serum comparators mirrored for status resolution;
- the existing 22 common comparator identities and 25 exact-unit records;
- free T3, free T4, and thyroid-stimulating hormone adult serum intervals.

The added thyroid intervals are:

| Biomarker | Unit | Published adult serum interval |
| --- | --- | ---: |
| Free T3 | pg/mL | 2.0–4.4 |
| Free T4 | ng/dL | 0.9–1.7 |
| TSH | mIU/L | 0.3–4.2 |

Pregnancy, illness, medications, biotin, age, and assay method remain explicit
caveats. A source-laboratory range always wins.

## Status safety

Ordinary published reference intervals can derive display status. Risk goals,
treatment goals, and disputed decision intervals remain chart context only.
That includes the generic cardiovascular comparators, the WHO ferritin
deficiency boundary, and the vitamin D decision interval. They remain visible
as published context but do not manufacture a universal `normal` result.

## Verification

- Health Metrics tests pin all 33 identities, 36 records, aliases, display
  projection behavior, and status mappings.
- Health Commons tests validate the shared records against the contract schema
  and keep the eight page-authored mirrors aligned with their source content.
- Query tests cover source-flag authority, source-range derivation, qualified
  range blocking, exact-unit/specimen fallback matching, context-only
  comparators, one-sided kidney context, and the new thyroid intervals.
- Web context tests prove the new thyroid ranges reach the production biomarker
  route while assay-heavy omissions remain neutral.
