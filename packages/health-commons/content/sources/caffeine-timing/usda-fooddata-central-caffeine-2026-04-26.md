---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:usda-fooddata-central-caffeine-2026-04-26
slug: sources/caffeine-timing/usda-fooddata-central-caffeine-2026-04-26
title: FoodData Central
summary: USDA FoodData Central is a public-domain/CC0 food-composition database with multiple data types that can support caffeine lookup for foods and branded products when protocol participants record source and dose.
status: draft
quality: usable
aliases:
- FoodData Central
- source_artifact:usda-fooddata-central-caffeine-2026-04-26
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: web_page
  title: FoodData Central
  authors: U.S. Department of Agriculture, Agricultural Research Service
  year: 2026
  journal: USDA FoodData Central
  citation: 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. USDA FoodData Central. 2026. URL: https://fdc.nal.usda.gov.'
  url: https://fdc.nal.usda.gov
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 3ea02ce340e89f48d5a0a277558cc890c2f1088cdaeb145f2f5f359aabbd771f
    url: https://fdc.nal.usda.gov
  canonicalUrl: https://fdc.nal.usda.gov
researchEvidence:
  designKind: guideline
  designLabel: USDA FoodData Central food-composition database
  populationLabel: Researchers, clinicians, and consumers using food-composition data.
  durationLabel: Continuously updated database; accessed/cited for this run on 2026-04-26.
  aggregateRole: primary
  cohortKey: usda-fooddata-central-caffeine
  notes:
  - 'Intervention or exposure: Food-composition database entries including caffeine where available across Foundation Foods, SR Legacy, FNDDS, and Branded Foods.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Caffeine values in foods and branded products, source verification.'
  - 'Effect or direction: FoodData Central is a USDA food-composition database that can be queried for caffeine entries in foods and branded products; USDA identifies its data as public domain/CC0.'
  - 'Adverse events or safety notes: No adverse events; safety relevance is dose verification.'
  - 'Population mismatch: Implementation database, not clinical curfew evidence.'
  - 'Limitations: Database entries vary by data type, serving assumptions, brand data completeness, and update cycle.'
evidenceBucket: caffeine_source_dose_audit
whyItMatters: FoodData Central gives an authoritative public database for checking caffeine content when participants log foods or branded items.
potentialMurphEndpoints:
- daily caffeine dose
- source fidelity
- food caffeine estimate
protocolTakeaway: Use FoodData Central as a verification source when a product label is unavailable, especially for foods and branded products.
murphTakeaway: Store the estimation basis—label, FoodData Central, or category estimate—so uncertainty is transparent.
studyDesign: food_composition_database
modality: fooddata-caffeine-database
claimUse: supports-protocol
sourceFindings:
- findingId: finding:usda-fooddata-central-caffeine-2026-04-26-fooddata-caffeine-database
  sourceKey: source_artifact:usda-fooddata-central-caffeine-2026-04-26
  extractedFromArtifactId: art_usda_fooddata_central_caffeine_2026_04_26_html
  findingKind: context
  population: Researchers, clinicians, and consumers using food-composition data.
  exposure: Food-composition database entries including caffeine where available across Foundation Foods, SR Legacy, FNDDS, and Branded Foods.
  outcome: Caffeine values in foods and branded products, source verification.
  summary: USDA FoodData Central is a public-domain/CC0 food-composition database with multiple data types that can support caffeine lookup for foods and branded products when protocol participants record source and dose.
  evidenceUse:
  - measurement
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **caffeine_source_dose_audit**.

**Findings:** USDA FoodData Central is a public-domain/CC0 food-composition database with multiple data types that can support caffeine lookup for foods and branded products when protocol participants record source and dose.

**Why it matters:** FoodData Central gives an authoritative public database for checking caffeine content when participants log foods or branded items.

**Potential experiment signals:** daily caffeine dose, source fidelity, food caffeine estimate.

**Protocol takeaway:** Use FoodData Central as a verification source when a product label is unavailable, especially for foods and branded products.

**Claim use:** `supports-protocol`.
