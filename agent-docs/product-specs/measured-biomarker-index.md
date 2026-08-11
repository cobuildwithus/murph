# Measured Biomarker Index

Status: Implemented
Last verified: 2026-08-09

## Purpose

`/biomarkers` is a calm navigation index over recognized measurements in a
member's private health history. It is not a raw lab-report viewer and must not
turn every imported scalar, procedure field, or report attribute into a
member-facing biomarker.

## Product contract

- Preserve canonical test-result rows, provenance, and the compact private lab
  projection independently of index visibility.
- Admit a lab result to the index only when the shared health-metrics owner maps
  its exact normalized identity to a member-facing health area.
- Keep unclassified rows out of the index. Unclassified means "not curated for
  this navigation surface," not deleted, medically unimportant, or invalid.
- Merge only explicit aliases that represent the same analyte. Do not use fuzzy
  medical matching. Related but distinct results, including ratios, absolute
  cell counts, percentages, nearby indices, and named calculation methods keep
  separate identities.
- Preserve the general metric catalog's cross-source identities and conversions,
  including the existing BUN, TSH, MCH, and MCHC semantics. Resolve additional
  identities from the expanded lab catalog only for test results. Those added
  lab labels must not change the identity, displayed value or unit, selection
  authority, goal behavior, or experiment support of a same-named manual
  measurement or metric sample.
- Normalize numeric units only when the conversion is owner-verified. Otherwise
  preserve the original unit and compare only like-for-like histories.
- Do not infer health meaning, severity, or a reference range from index
  membership. Show the imported flag when present and otherwise stay neutral.

## Information architecture

1. Show device-derived measurements with actual private readings first.
2. Search and `All` / `Review` / `In range` filters apply only to the saved lab
   index; missing source flags remain neutral and available under `All`.
3. Show only non-empty curated lab health areas, in the stable shared registry
   order.
4. Keep every lab area expanded by default using a native disclosure. Its
   summary shows only the area label and disclosure chevron.
5. Use the measured-biomarker notebook index as one partitioned surface with
   one full-width biomarker row at every viewport. Stack name and result on
   phones; align name left and status/value right from small screens upward.
6. Each full-row link shows only the stable display name, source status, and
   latest value. Sort flagged results before in-range and unflagged results
   within each health area.
7. Never render a catch-all `Other` area on this page. If saved lab rows exist
   but none are classified, say that no recognized biomarkers are available
   while confirming that the saved records remain available.

## Result detail contract

- Lead with the exact latest result, source status, and collection date. Keep
  source/lab and source-specific reference range provenance in the chart context
  and complete result ledger rather than repeating it beside the latest value.
  Do not substitute Commons guidance for the result's own range or flag.
- When an authored Health Commons page maps to the canonical lab identity, use
  its one-sentence summary below the title and keep saved-history count/date
  context as secondary metadata.
- Plot only exact numeric results that the query owner has already established
  as comparable. Comparator and qualitative results stay exact in the ledger
  and never become invented points.
- When the latest result belongs to the normalized comparable series and has a
  numeric source range, show that range as quiet dashed boundary rules labeled
  `Latest lab range`. Preserve exact one-sided source comparators. Fit the
  vertical scale to the union of the comparable results and available range
  bounds, then shade the in-range region with very light sage and the visible
  below/above regions with very light sienna. Keep the label and dashed rules as
  non-color cues, and do not imply that older labs used the same range.
- When that latest comparable result has no usable numeric source range, an
  exact-unit reviewed Health Commons comparator may appear only when the
  imported result has an explicitly eligible coarse specimen kind. Label it
  `Published adult comparator`, retain its exact source label, and state that it
  is not the reporting lab's range. Keep its boundary rules neutral and
  dashed-only; do not reuse the sage/sienna lab-range bands or let it imply
  source status. Keep the imported source flag authoritative. A qualified
  source range stays exact in the ledger and blocks every published comparator.
- Health Commons owns two authored comparator inputs at one package boundary:
  page-specific `referenceGuidance.fallbackRanges` and the reviewed common
  catalog in `packages/health-commons/src/biomarker-fallback-ranges.ts`. The
  result route asks that owner for both and keeps page-authored entries first;
  `apps/web` does not own numeric values or maintain an independent range table.
- The reviewed catalog covers 30 canonical biomarker identities through 33
  exact-unit comparator records: 8 page-authored serum intervals plus 25 common
  catalog records across 22 additional identities. The expansion includes
  albumin; anion gap; generic and CKD-EPI eGFR; total, LDL, calculated LDL,
  non-HDL, triglyceride, ApoB, lipoprotein(a), and hs-CRP context; ferritin and
  vitamin D decision context; total iron-binding capacity and iron saturation;
  zinc; methylmalonic acid; rheumatoid factor; and thyroid antibodies.
- A published clinical or desirable-value boundary remains neutral context, not
  a manufactured reporting-lab interval or an individualized treatment goal.
  Formula-specific results retain their exact identities. Vitamin D, TIBC, and
  iron saturation carry explicit exact-unit alternatives instead of relying on
  frontend conversion. Unitless or mismatched results continue to fail closed.
- The 2026-08-09 audit reviewed all 115 canonical saved-lab identities rather
  than treating every missing interval as unfinished work. POC troponin I,
  BUN/creatinine ratio, historical race-based MDRD outputs, random urine albumin
  without creatinine, immature granulocytes, reproductive hormones, proprietary
  OmegaCheck outputs, and demographic or collection-sensitive measurements
  remain without portable comparators when the current resolver cannot prove
  assay, analyzer, specimen, sex, age, pregnancy, fasting, timing, or risk
  applicability.
- Let the graph follow the latest-reading block without a redundant visible
  chart title or a single-result instruction. The accessible chart name still
  identifies the biomarker and reference context.
- Keep the result ledger available at every viewport. The full four-column
  layout starts only when it fits; smaller screens use one accessible stacked
  representation rather than duplicated desktop/mobile markup.
- Prefer a quiet omission over long chart caveats. If there is no comparable
  numeric series, show the exact saved history without an empty chart or a
  rationale card.
- Offer the existing Chat with Murph contact action with a short draft based on
  the public biomarker display name. Do not place the member's private value,
  date, source, flag, or reference range in an external compose URL.

## Explicitly excluded classes

Unless a future owner deliberately classifies a specific measurement, the
index excludes administrative/report metadata, malformed value-as-analyte
fields, ECG and exercise-test procedure fields, routine urinalysis attributes,
infectious screening and culture outcomes, blood type, genetics report
commentary, and unknown custom fields.

## Reviewed content coverage

The requested content set contains 122 labels: 117 saved-lab labels and 5
device markers. Canonicalization produces 115 distinct lab identities and 5
device identities, for 120 authored Commons entities. The two true label alias
pairs are `MPV` / `Mean Platelet Volume` and `CO2` / `Carbon Dioxide`.

| Measure | Count |
| --- | ---: |
| Requested labels | 122 |
| Requested saved-lab labels | 117 |
| Distinct saved-lab identities | 115 |
| Requested device identities | 5 |
| Authored Commons entities | 120 |
| Existing pages updated | 21 |
| New pages added | 99 |
| Explicit metric-to-Commons mappings | 6 |

The explicit mappings preserve stable metric identities while reusing the
correct existing authored analyte page:

| Metric biomarker key | Authored Commons entity |
| --- | --- |
| `biomarker:alt` | `biomarker:alanine-aminotransferase` |
| `biomarker:apob` | `biomarker:apolipoprotein-b` |
| `biomarker:ast` | `biomarker:aspartate-aminotransferase` |
| `biomarker:creatinine` | `biomarker:serum-creatinine` |
| `biomarker:total-bilirubin` | `biomarker:bilirubin` |
| `biomarker:vitamin-d` | `biomarker:serum-25-hydroxyvitamin-d` |

| Guidance classification | Entities |
| --- | ---: |
| Generally applicable numeric | 1 |
| Conditional numeric | 11 |
| Calculated or method-specific | 17 |
| Qualitative | 3 |
| Source-range-only | 52 |
| No universal range | 36 |
| **Total** | **120** |

Twelve entities use a numeric classification. FIB-4 and vitamin D retain
tightly scoped numeric decision items while remaining classified for the
governing limitation: FIB-4 is calculation-specific, and vitamin D records
conflicting guidance rather than a false universal range.

The coverage tests keep distinct LDL calculation methods; generic, CKD-EPI,
and historical MDRD eGFR outputs; percentage and absolute differential counts;
OmegaCheck panels, individual fatty acids, and ratios; generic mercury and any
future specimen-specific mercury assay; and POC troponin I versus any
assay-specific troponin identity or cutoff. Historical MDRD outputs remain for
report provenance but are not normalized into current race-free eGFR
identities.

Five evidence limitations remain explicit rather than being filled with false
precision:

1. Generic `Mercury` does not identify specimen or chemical species, so no
   portable numeric range is encoded and specimen-specific aliases remain
   excluded.
2. `POC Troponin I` does not identify an instrument or assay generation, so its
   exact 99th-percentile upper reference limit comes from the assay
   documentation and reporting source.
3. Calculated LDL, NIH LDL, anion gap, and eGFR comparators stay bound to their
   exact calculation identity and are labeled as published context; they never
   become another analyte's lab range. BUN/creatinine ratio and historical
   race-based MDRD outputs remain omitted.
4. Random urine albumin concentration, reproductive hormones, immature
   granulocytes, and proprietary fatty-acid panels need collection, demographic,
   analyzer, or assay context that the portable comparator gate intentionally
   does not own.
5. Several living assay catalogs do not publish a stable publication year;
   source metadata records the 2026 review year with the exact title and URL.

These are contextual limitations, not missing page coverage. The request's
health-area groups remain navigation only and do not imply medical equivalence,
interchangeable assays, or shared reference guidance.

## Ownership

- `packages/health-metrics` owns canonical lab identities, explicit aliases,
  verified unit normalization, stable health-area order, and index admission.
  Its expanded lab-result catalog is separate from the general metric catalog.
- `packages/query` preserves lab rows and applies admission only in the measured
  index selector. Exact lab-row and detail queries remain read-only views of the
  preserved projection, and projection-version changes rebuild stored metric
  identities when alias semantics change.
- `packages/contracts` owns the shared browser-replica generation. The expanded
  alias interpretation advances it to generation 2 so generation-1 sidecars are
  served as stale and refresh through the existing runtime path.
- `packages/health-commons` owns every reviewed public comparator, its exact
  unit, eligible specimen kinds, source metadata, applicability caveat, and
  display-only projection. Page content and the common typed catalog are sibling
  authoring surfaces under that owner; neither can alter a private result flag.
- `apps/web` owns device-first ordering and the disclosure/notebook presentation;
  it merges owner-provided comparator projections only and must not maintain a
  second classification or numeric-range list.

## Verification

- Registry tests cover every cataloged lab metric, representative admitted
  analytes, and representative excluded record-field classes.
- Query tests prove excluded rows remain in the private projection and direct
  detail selection while staying out of the measured index.
- UI tests cover device-first ordering, initially expanded disclosures, search,
  status filters, flagged-first ordering, the one-row notebook shape,
  full-row links, the absence of `Other`, and the saved-but-unclassified empty
  state. Detail tests cover exact comparators, qualitative history, latest-range
  band geometry and domain inclusion, neutral published-comparator context,
  malformed-range omission, missing or qualified range withholding, responsive
  ledger structure, and Commons summary fallback.
- Health Commons coverage tests resolve every requested lab and device identity,
  enforce the deliberate aliases and non-equivalences, validate one-sentence
  summaries and source locators, lock the guidance-classification counts, pin the
  8 page-authored comparators plus all 22 common-catalog entities and 25 exact-unit
  records, and preserve context-dependent omissions for unportable assay,
  demographic, collection, and proprietary cases.
