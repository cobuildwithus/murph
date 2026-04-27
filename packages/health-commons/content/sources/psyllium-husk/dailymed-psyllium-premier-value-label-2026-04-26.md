---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:dailymed-psyllium-premier-value-label-2026-04-26"
slug: "sources/psyllium-husk/dailymed-psyllium-premier-value-label-2026-04-26"
title: "DailyMed label: Premier Value 100% Natural Psyllium Husk Orange Flavor Sugar Free"
summary: "DailyMed consumer label for Premier Value psyllium husk powder showing 3.4 g psyllium per teaspoon plus choking, allergy, liquid, medication-spacing, minor-bloating, and cholesterol-support language."
status: "draft"
quality: "usable"
aliases:
  - "DailyMed label: Premier Value 100% Natural Psyllium Husk Orange Flavor Sugar Free"
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
  title: "DailyMed label: Premier Value 100% Natural Psyllium Husk Orange Flavor Sugar Free"
  authors: "Pharmacy Value Alliance, LLC"
  journal: "DailyMed"
  url: "https://www.dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=2d580965-2bef-46ee-8532-fbe34330a4b4&type=display"
  citation: "Pharmacy Value Alliance, LLC. DailyMed label: Premier Value 100% Natural Psyllium Husk Orange Flavor Sugar Free. DailyMed. https://www.dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=2d580965-2bef-46ee-8532-fbe34330a4b4&type=display"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://www.dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=2d580965-2bef-46ee-8532-fbe34330a4b4&type=display"
  canonicalUrl: "https://www.dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=2d580965-2bef-46ee-8532-fbe34330a4b4&type=display"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  populationLabel: "OTC psyllium users"
  durationLabel: "Consumer label; no intervention follow-up."
  aggregateRole: "primary"
  cohortKey: "cohort:dailymed-psyllium-premier-value-label-2026-04-26:source-population"
  notes:
    - "Batch batch-005 extraction; claim use safety-only."
    - "Limitations: Product label; no measured outcomes.; Intended as label-language comparison, not efficacy evidence."
    - "Population mismatch: General OTC consumer use rather than supervised LDL-C intervention."
evidenceBucket: "Safety, adverse events, and drug-interaction boundaries"
whyItMatters: "Additional DailyMed consumer-label variant for the same oral psyllium-husk product class, useful for label-language comparison."
potentialMurphEndpoints:
  - "choking"
  - "allergy"
  - "hydration"
  - "medication absorption"
protocolTakeaway: "A protocol can cite this as redundant label support for consumer implementation safeguards."
murphTakeaway: "Murph extraction should preserve this source as safety/context evidence and avoid promoting it into a direct LDL-C claim."
studyDesign: "guideline"
modality: "oral psyllium husk / ispaghula husk safety, tolerability, label, or adjacent context"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:dailymed-psyllium-premier-value-label-2026-04-26-premier-serving"
    sourceKey: "source_artifact:dailymed-psyllium-premier-value-label-2026-04-26"
    extractedFromArtifactId: "art_dailymed_psyllium_premier_value_label_2026_04_26"
    findingKind: "context"
    population: "OTC psyllium users."
    exposure: "One teaspoon of Premier Value psyllium husk powder."
    outcome: "Labeled active psyllium amount."
    summary: "The label lists psyllium husk 3.4 g in each teaspoon."
    evidenceUse:
      - "context"
  -
    findingId: "finding:dailymed-psyllium-premier-value-label-2026-04-26-premier-fluid-allergy"
    sourceKey: "source_artifact:dailymed-psyllium-premier-value-label-2026-04-26"
    extractedFromArtifactId: "art_dailymed_psyllium_premier_value_label_2026_04_26"
    findingKind: "safety"
    population: "OTC psyllium users."
    exposure: "Psyllium husk powder in liquid."
    outcome: "Choking and allergy warnings."
    summary: "The label warns that inadequate fluid can cause swelling and blockage and includes an allergy alert for psyllium sensitivity."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:dailymed-psyllium-premier-value-label-2026-04-26-premier-med-bloating"
    sourceKey: "source_artifact:dailymed-psyllium-premier-value-label-2026-04-26"
    extractedFromArtifactId: "art_dailymed_psyllium_premier_value_label_2026_04_26"
    findingKind: "safety"
    population: "OTC psyllium users taking other medicines or starting fiber."
    exposure: "Psyllium powder dosing up to label directions."
    outcome: "Medication timing and GI tolerability."
    summary: "The label tells users to separate other medicines by at least 2 hours and notes minor bloating may occur."
    evidenceUse:
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
interventionOrExposure: "Oral psyllium husk powder/fiber supplement"
comparatorOrControl: "Not applicable or not extracted for this safety/context source."
durationOrFollowUp: "Consumer label; no intervention follow-up."
endpoints:
  - "choking"
  - "allergy"
  - "hydration"
  - "medication absorption"
adverseEventsOrSafetyNotes:
  - "The label warns that inadequate fluid can cause swelling and blockage and includes an allergy alert for psyllium sensitivity."
  - "The label tells users to separate other medicines by at least 2 hours and notes minor bloating may occur."
limitations:
  - "Product label; no measured outcomes."
  - "Intended as label-language comparison, not efficacy evidence."
populationMismatch: "General OTC consumer use rather than supervised LDL-C intervention."
directnessToProtocol: "general_guideline"
---
This source is included for **Safety, adverse events, and drug-interaction boundaries**.

**Findings:**

- `finding:dailymed-psyllium-premier-value-label-2026-04-26-premier-serving` — The label lists psyllium husk 3.4 g in each teaspoon.
- `finding:dailymed-psyllium-premier-value-label-2026-04-26-premier-fluid-allergy` — The label warns that inadequate fluid can cause swelling and blockage and includes an allergy alert for psyllium sensitivity.
- `finding:dailymed-psyllium-premier-value-label-2026-04-26-premier-med-bloating` — The label tells users to separate other medicines by at least 2 hours and notes minor bloating may occur.

**Why it matters:** Additional DailyMed consumer-label variant for the same oral psyllium-husk product class, useful for label-language comparison.

**Potential experiment signals:**

- choking
- allergy
- hydration
- medication absorption

**Protocol takeaway:** A protocol can cite this as redundant label support for consumer implementation safeguards.

**Limitations and population mismatch:** Product label; no measured outcomes.; Intended as label-language comparison, not efficacy evidence. Population mismatch: General OTC consumer use rather than supervised LDL-C intervention.

**Claim use:** `safety-only`.
