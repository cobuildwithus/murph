# Measured Biomarker Index

Status: Implemented
Last verified: 2026-07-20

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
- Resolve the expanded alias catalog and its lab-only unit semantics only for
  test results. A lab label must not change the identity, displayed value or
  unit, selection authority, goal behavior, or experiment support of a
  same-named manual measurement or metric sample.
- Normalize numeric units only when the conversion is owner-verified. Otherwise
  preserve the original unit and compare only like-for-like histories.
- Do not infer health meaning, severity, or a reference range from index
  membership. Show the imported flag when present and otherwise stay neutral.

## Information architecture

1. Show device-derived measurements with actual private readings first.
2. Show only non-empty curated lab health areas, in the stable shared registry
   order.
3. Keep every lab area closed by default using a native disclosure. Its summary
   shows the area label and biomarker count.
4. When opened, use the measured-biomarker notebook index: a single partitioned
   surface, one column on narrow screens and two columns from tablet widths.
5. Each biomarker row shows its stable display name, result count and history
   span, latest value and date, then links to its private longitudinal detail.
6. Never render a catch-all `Other` area on this page. If saved lab rows exist
   but none are classified, say that no recognized biomarkers are available
   while confirming that the saved records remain available.

## Explicitly excluded classes

Unless a future owner deliberately classifies a specific measurement, the
index excludes administrative/report metadata, malformed value-as-analyte
fields, ECG and exercise-test procedure fields, routine urinalysis attributes,
infectious screening and culture outcomes, blood type, genetics report
commentary, and unknown custom fields.

## Ownership

- `packages/health-metrics` owns canonical lab identities, explicit aliases,
  verified unit normalization, stable health-area order, and index admission.
  Its expanded lab-result catalog is separate from the general metric catalog.
- `packages/query` preserves lab rows and applies admission only in the measured
  index selector. Exact lab-row and detail queries remain read-only views of the
  preserved projection, and projection-version changes rebuild stored metric
  identities when alias semantics change.
- `apps/web` owns device-first ordering and the disclosure/notebook presentation;
  it must not maintain a second classification list.

## Verification

- Registry tests cover every cataloged lab metric, representative admitted
  analytes, and representative excluded record-field classes.
- Query tests prove excluded rows remain in the private projection and direct
  detail selection while staying out of the measured index.
- UI tests cover device-first ordering, closed disclosures, responsive notebook
  shape, the absence of `Other`, and the saved-but-unclassified empty state.
