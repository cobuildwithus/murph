---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:dailymed-psyllium-health-mart-label-2026-04-26"
slug: "sources/psyllium-husk/dailymed-psyllium-health-mart-label-2026-04-26"
title: "DailyMed label: Bulk-Forming Laxative (psyllium husk powder, for suspension)"
summary: "Representative DailyMed bulk-forming laxative/fiber supplement label with 3.4 g psyllium per rounded teaspoon, soluble-fiber cholesterol-program wording, fluid warnings, allergy alert, and two-hour medication separation."
status: "draft"
quality: "usable"
aliases:
  - "DailyMed label: Bulk-Forming Laxative (psyllium husk powder, for suspension)"
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
  title: "DailyMed label: Bulk-Forming Laxative (psyllium husk powder, for suspension)"
  authors: "Health Mart"
  year: 2012
  journal: "DailyMed"
  url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=4ed99635-9cec-4ce6-976f-76878a348c74"
  citation: "Health Mart. (2012). DailyMed label: Bulk-Forming Laxative (psyllium husk powder, for suspension). DailyMed. https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=4ed99635-9cec-4ce6-976f-76878a348c74"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=4ed99635-9cec-4ce6-976f-76878a348c74"
  canonicalUrl: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=4ed99635-9cec-4ce6-976f-76878a348c74"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  populationLabel: "OTC psyllium users"
  durationLabel: "Consumer label; no intervention follow-up."
  aggregateRole: "primary"
  cohortKey: "cohort:dailymed-psyllium-health-mart-label-2026-04-26:source-population"
  notes:
    - "Batch batch-005 extraction; claim use safety-only."
    - "Limitations: Label source; no randomization or outcomes.; Serving details may not match other products."
    - "Population mismatch: Broad OTC consumer population rather than supervised cholesterol protocol participants."
evidenceBucket: "Safety, adverse events, and drug-interaction boundaries"
whyItMatters: "Representative US OTC label with choking, allergy, hydration, and 2-hour medication-separation language plus cholesterol-program wording."
potentialMurphEndpoints:
  - "choking"
  - "obstruction"
  - "allergy"
  - "hydration"
  - "medication absorption"
  - "bloating"
protocolTakeaway: "Protocol copy should not treat cholesterol-program wording as a substitute for full-glass, allergy, and medication-separation warnings."
murphTakeaway: "Murph extraction should preserve this source as safety/context evidence and avoid promoting it into a direct LDL-C claim."
studyDesign: "guideline"
modality: "oral psyllium husk / ispaghula husk safety, tolerability, label, or adjacent context"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:dailymed-psyllium-health-mart-label-2026-04-26-healthmart-serving-soluble"
    sourceKey: "source_artifact:dailymed-psyllium-health-mart-label-2026-04-26"
    extractedFromArtifactId: "art_dailymed_psyllium_health_mart_label_2026_04_26"
    findingKind: "context"
    population: "OTC psyllium users considering a cholesterol-lowering program."
    exposure: "Rounded teaspoon/7 g product serving containing psyllium 3.4 g."
    outcome: "Labeled soluble-fiber contribution."
    summary: "The label reports 3.4 g psyllium per rounded teaspoon/7 g serving and states one adult serving provides 2.4 g soluble fiber."
    evidenceUse:
      - "context"
  -
    findingId: "finding:dailymed-psyllium-health-mart-label-2026-04-26-healthmart-liquid-allergy"
    sourceKey: "source_artifact:dailymed-psyllium-health-mart-label-2026-04-26"
    extractedFromArtifactId: "art_dailymed_psyllium_health_mart_label_2026_04_26"
    findingKind: "safety"
    population: "OTC psyllium users, especially people with swallowing difficulty or psyllium sensitivity."
    exposure: "Psyllium husk powder for suspension."
    outcome: "Choking, obstruction, and allergy warnings."
    summary: "The label includes a choking warning tied to inadequate fluid, directs mixing with at least 8 oz liquid, and warns of possible allergic reaction in people sensitive to inhaled or ingested psyllium."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:dailymed-psyllium-health-mart-label-2026-04-26-healthmart-med-spacing"
    sourceKey: "source_artifact:dailymed-psyllium-health-mart-label-2026-04-26"
    extractedFromArtifactId: "art_dailymed_psyllium_health_mart_label_2026_04_26"
    findingKind: "safety"
    population: "OTC psyllium users taking oral medicines."
    exposure: "Psyllium near prescription medicines."
    outcome: "Medication absorption/timing warning."
    summary: "The label advises taking prescription medicines at least 2 hours before or after psyllium because laxatives may affect how other drugs work."
    evidenceUse:
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
interventionOrExposure: "Oral psyllium husk powder/fiber supplement"
comparatorOrControl: "Not applicable or not extracted for this safety/context source."
durationOrFollowUp: "Consumer label; no intervention follow-up."
endpoints:
  - "choking"
  - "obstruction"
  - "allergy"
  - "hydration"
  - "medication absorption"
  - "bloating"
adverseEventsOrSafetyNotes:
  - "The label includes a choking warning tied to inadequate fluid, directs mixing with at least 8 oz liquid, and warns of possible allergic reaction in people sensitive to inhaled or ingested psyllium."
  - "The label advises taking prescription medicines at least 2 hours before or after psyllium because laxatives may affect how other drugs work."
limitations:
  - "Label source; no randomization or outcomes."
  - "Serving details may not match other products."
populationMismatch: "Broad OTC consumer population rather than supervised cholesterol protocol participants."
directnessToProtocol: "general_guideline"
---
This source is included for **Safety, adverse events, and drug-interaction boundaries**.

**Findings:**

- `finding:dailymed-psyllium-health-mart-label-2026-04-26-healthmart-serving-soluble` — The label reports 3.4 g psyllium per rounded teaspoon/7 g serving and states one adult serving provides 2.4 g soluble fiber.
- `finding:dailymed-psyllium-health-mart-label-2026-04-26-healthmart-liquid-allergy` — The label includes a choking warning tied to inadequate fluid, directs mixing with at least 8 oz liquid, and warns of possible allergic reaction in people sensitive to inhaled or ingested psyllium.
- `finding:dailymed-psyllium-health-mart-label-2026-04-26-healthmart-med-spacing` — The label advises taking prescription medicines at least 2 hours before or after psyllium because laxatives may affect how other drugs work.

**Why it matters:** Representative US OTC label with choking, allergy, hydration, and 2-hour medication-separation language plus cholesterol-program wording.

**Potential experiment signals:**

- choking
- obstruction
- allergy
- hydration
- medication absorption
- bloating

**Protocol takeaway:** Protocol copy should not treat cholesterol-program wording as a substitute for full-glass, allergy, and medication-separation warnings.

**Limitations and population mismatch:** Label source; no randomization or outcomes.; Serving details may not match other products. Population mismatch: Broad OTC consumer population rather than supervised cholesterol protocol participants.

**Claim use:** `safety-only`.
