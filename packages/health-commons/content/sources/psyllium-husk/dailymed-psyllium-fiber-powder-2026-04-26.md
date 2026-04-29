---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:dailymed-psyllium-fiber-powder-2026-04-26"
slug: "sources/psyllium-husk/dailymed-psyllium-fiber-powder-2026-04-26"
title: "Psyllium Fiber Powder label"
summary: "DailyMed label for a psyllium fiber powder with soluble-fiber heart-health wording, serving information, full-glass liquid notice, drug-spacing language, and product-specific warnings."
status: "draft"
quality: "usable"
aliases:
  - "Psyllium Fiber Powder label"
categories:
  - "psyllium-husk"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:psyllium-husk"
source:
  kind: "web_page"
  title: "Psyllium Fiber Powder label"
  authors: "DailyMed / National Library of Medicine"
  year: 2026
  journal: "DailyMed"
  url: "https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=afc52039-2370-4c21-b9c8-733ec009e881"
  citation: "DailyMed / National Library of Medicine. (2026). Psyllium Fiber Powder label. DailyMed. https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=afc52039-2370-4c21-b9c8-733ec009e881"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=afc52039-2370-4c21-b9c8-733ec009e881"
  canonicalUrl: "https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=afc52039-2370-4c21-b9c8-733ec009e881"
researchEvidence:
  designKind: "other"
  designLabel: "other"
  populationLabel: "OTC psyllium powder users"
  durationLabel: "Current consumer label; no intervention follow-up."
  aggregateRole: "primary"
  cohortKey: "cohort:dailymed-psyllium-fiber-powder-2026-04-26:source-population"
  notes:
    - "Batch batch-005 extraction; claim use safety-only."
    - "Limitations: Product label rather than trial.; Some serving/soluble-fiber values differ by label panel, so extraction should not over-standardize dose from this label alone."
    - "Population mismatch: OTC label population rather than trial participants with measured LDL-C."
evidenceBucket: "Safety, adverse events, and drug-interaction boundaries"
whyItMatters: "Product-label implementation source for powder serving, 7 g/day soluble-fiber health-claim language, and 2-hour medication spacing warning."
potentialMurphEndpoints:
  - "label dose"
  - "soluble fiber per serving"
  - "medication spacing"
  - "hydration warning"
  - "GI tolerance"
protocolTakeaway: "Use this source for label-bound implementation cautions, not for estimating LDL-C change."
murphTakeaway: "Murph extraction should preserve this source as safety/context evidence and avoid promoting it into a direct LDL-C claim."
studyDesign: "other"
modality: "oral psyllium husk / ispaghula husk safety, tolerability, label, or adjacent context"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:dailymed-psyllium-fiber-powder-2026-04-26-fiber-powder-serving-claim"
    sourceKey: "source_artifact:dailymed-psyllium-fiber-powder-2026-04-26"
    extractedFromArtifactId: "art_dailymed_psyllium_fiber_powder_2026_04_26"
    findingKind: "context"
    population: "OTC psyllium powder users considering fiber intake for heart-health labeling."
    exposure: "Psyllium fiber powder serving."
    outcome: "Soluble-fiber health-claim context."
    summary: "The label includes 7 g/day soluble-fiber-from-psyllium heart-disease risk-reduction wording and product serving information."
    evidenceUse:
      - "context"
  -
    findingId: "finding:dailymed-psyllium-fiber-powder-2026-04-26-fiber-powder-liquid-warning"
    sourceKey: "source_artifact:dailymed-psyllium-fiber-powder-2026-04-26"
    extractedFromArtifactId: "art_dailymed_psyllium_fiber_powder_2026_04_26"
    findingKind: "safety"
    population: "OTC users of dry psyllium powder."
    exposure: "Psyllium powder mixed with liquid."
    outcome: "Choking and swallowing-difficulty warning."
    summary: "The label instructs mixing in at least 8 oz of liquid and avoiding use by people with swallowing difficulty."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:dailymed-psyllium-fiber-powder-2026-04-26-fiber-powder-med-spacing"
    sourceKey: "source_artifact:dailymed-psyllium-fiber-powder-2026-04-26"
    extractedFromArtifactId: "art_dailymed_psyllium_fiber_powder_2026_04_26"
    findingKind: "safety"
    population: "Users taking prescription medicines by mouth."
    exposure: "Psyllium powder near oral medicines."
    outcome: "Drug-absorption timing warning."
    summary: "The label advises taking prescription drugs at least 2 hours before or after psyllium and notes laxatives may affect how other drugs work."
    evidenceUse:
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
interventionOrExposure: "Psyllium husk powder; label gives soluble-fiber serving information and medication-spacing warnings"
comparatorOrControl: "Not applicable or not extracted for this safety/context source."
durationOrFollowUp: "Current consumer label; no intervention follow-up."
endpoints:
  - "label dose"
  - "soluble fiber per serving"
  - "medication spacing"
  - "hydration warning"
  - "GI tolerance"
adverseEventsOrSafetyNotes:
  - "The label instructs mixing in at least 8 oz of liquid and avoiding use by people with swallowing difficulty."
  - "The label advises taking prescription drugs at least 2 hours before or after psyllium and notes laxatives may affect how other drugs work."
limitations:
  - "Product label rather than trial."
  - "Some serving/soluble-fiber values differ by label panel, so extraction should not over-standardize dose from this label alone."
populationMismatch: "OTC label population rather than trial participants with measured LDL-C."
directnessToProtocol: "general_guideline"
---
This source is included for **Safety, adverse events, and drug-interaction boundaries**.

**Findings:**

- `finding:dailymed-psyllium-fiber-powder-2026-04-26-fiber-powder-serving-claim` — The label includes 7 g/day soluble-fiber-from-psyllium heart-disease risk-reduction wording and product serving information.
- `finding:dailymed-psyllium-fiber-powder-2026-04-26-fiber-powder-liquid-warning` — The label instructs mixing in at least 8 oz of liquid and avoiding use by people with swallowing difficulty.
- `finding:dailymed-psyllium-fiber-powder-2026-04-26-fiber-powder-med-spacing` — The label advises taking prescription drugs at least 2 hours before or after psyllium and notes laxatives may affect how other drugs work.

**Why it matters:** Product-label implementation source for powder serving, 7 g/day soluble-fiber health-claim language, and 2-hour medication spacing warning.

**Potential experiment signals:**

- label dose
- soluble fiber per serving
- medication spacing
- hydration warning
- GI tolerance

**Protocol takeaway:** Use this source for label-bound implementation cautions, not for estimating LDL-C change.

**Limitations and population mismatch:** Product label rather than trial.; Some serving/soluble-fiber values differ by label panel, so extraction should not over-standardize dose from this label alone. Population mismatch: OTC label population rather than trial participants with measured LDL-C.

**Claim use:** `safety-only`.
