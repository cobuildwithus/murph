# Biomarker derived display status

Status: completed
Created: 2026-08-09
Updated: 2026-08-10

## Goal

When a laboratory report omits a result flag, show a useful `In range`, `Above
range`, or `Below range` presentation when Murph has enough exact numeric
context to do so, without changing the imported laboratory record.

## Authority order

The presentation resolver applies one stable order:

1. preserve an explicit reporting-laboratory flag;
2. otherwise classify a numeric result against the reporting laboratory's
   safely normalized numeric range;
3. otherwise, only when the source supplied no range, classify against an
   exact-unit and eligible-specimen reviewed reference interval;
4. otherwise remain neutral as `Reported`.

Qualified or unnormalizable source range wording blocks the generic comparator.
The browser-replica rows and canonical blood-test event remain unchanged;
selectors derive status on presentation clones only.

Comparator-valued results are classified conservatively. For example, `<3.5`
against an inclusive 3.5–5.0 interval is unambiguously below range, while `<=3.5`
or `<4.0` remains neutral because the censored domain spans more than one
status. One-sided results such as `>=60` can be marked in range against a
lower-only eGFR boundary when every possible value satisfies that boundary.

## Shared architecture

`packages/health-metrics/src/lab-reference-ranges.ts` owns the runtime catalog
used by both the Health Commons projection and the browser biomarker selectors.
It carries exact bounds, units, eligible specimen kinds, source metadata,
applicability language, and explicit status semantics. Health Commons continues
to expose source-free display ranges to Web routes, while Query reuses the same
catalog to derive presentation flags. This avoids a second Web-only number table
and keeps the list, filters, result header, and history ledger on one status
resolver.

Eight page-authored serum comparators remain authored in Health Commons content.
The runtime catalog mirrors those eight for status resolution but never exposes
those mirrors as duplicate display ranges.

Browser-vault generation 4 retains canonical `whole_blood` specimen context so
existing CBC rows can use whole-blood-only comparators. Older replicas refresh
through the existing generation-aware path; canonical source records are not
rewritten.

## Coverage

The reviewed runtime catalog covers 40 canonical biomarker identities through
43 exact-unit records:

- eight page-authored serum comparators mirrored for status resolution;
- the existing 22 common comparator identities and 25 exact-unit records;
- free T3, free T4, and thyroid-stimulating hormone adult serum intervals;
- seven sex-neutral adult whole-blood CBC intervals.

The added thyroid intervals are:

| Biomarker | Unit | Published adult serum interval |
| --- | --- | ---: |
| Free T3 | pg/mL | 2.0–4.4 |
| Free T4 | ng/dL | 0.9–1.7 |
| TSH | mIU/L | 0.3–4.2 |

The added Mayo Clinic Laboratories whole-blood CBC intervals are:

| Biomarker | Unit | Published adult interval |
| --- | --- | ---: |
| White blood cells | 10^3/uL | 3.4–9.6 |
| Mean corpuscular volume | fL | 78.2–97.9 |
| Absolute neutrophils | 10^3/uL | 1.56–6.45 |
| Absolute lymphocytes | 10^3/uL | 0.95–3.07 |
| Absolute monocytes | 10^3/uL | 0.26–0.81 |
| Absolute eosinophils | 10^3/uL | 0.03–0.48 |
| Absolute basophils | 10^3/uL | 0.01–0.08 |

Pregnancy, illness, medications, biotin, age, analyzer, assay method, and local
reference-population differences remain explicit caveats. A source-laboratory
range always wins.

## Status safety

Ordinary published reference intervals can derive display status. Risk goals,
treatment goals, and disputed decision intervals remain chart context only.
That includes the generic cardiovascular comparators, the WHO ferritin
deficiency boundary, and the vitamin D decision interval. They remain visible
as published context but do not manufacture a universal `normal` result.

Sex-specific CBC ranges such as hemoglobin, hematocrit, red-cell count, and
platelet intervals remain omitted until the private projection can prove the
necessary demographic applicability. The seven added CBC ranges are limited to
adult intervals shared across sexes in the reviewed source.

## Verification

- Health Metrics tests pin all 40 identities, 43 records, aliases, display
  projection behavior, specimen applicability, and status mappings.
- Health Commons tests validate serum/plasma records against the authored
  contract and source-lock the whole-blood extension separately.
- Query tests cover source-flag authority, source-range derivation, qualified
  range blocking, exact-unit/specimen fallback matching, conservative censored
  values, context-only comparators, one-sided kidney context, thyroid intervals,
  and whole-blood CBC classification.
- Web context tests prove reviewed ranges reach the production biomarker route
  while assay-heavy omissions remain neutral.
