---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:dailymed-psyllium-husk-capsule-2026-04-26"
slug: "sources/psyllium-husk/dailymed-psyllium-husk-capsule-2026-04-26"
title: "Fiber - psyllium husk capsule label"
summary: "DailyMed label is implementation and safety context for capsule formulations; it is not efficacy evidence."
status: "draft"
quality: "usable"
aliases:
  - "Fiber - psyllium husk capsule label"
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
  title: "Fiber - psyllium husk capsule label"
  authors: "DailyMed; National Library of Medicine"
  year: 2014
  journal: "DailyMed"
  url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=d5d1b0fb-8c8a-45f3-ae80-0c799d4d48ba"
  citation: "DailyMed. Label: FIBER- psyllium husk capsule. National Library of Medicine. Updated November 26, 2014. Accessed April 26, 2026."
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "f804def33fd0bb5f4aa9feae18193c6177548f0a0450cfc2de5bf52733cc6260"
    url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=d5d1b0fb-8c8a-45f3-ae80-0c799d4d48ba"
  canonicalUrl: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=d5d1b0fb-8c8a-45f3-ae80-0c799d4d48ba"
  identityAliases:
    - "Fiber - psyllium husk capsule label"
researchEvidence:
  designKind: "other"
  designLabel: "OTC product label and implementation context"
  populationLabel: "OTC psyllium capsule users"
  durationLabel: "Label instructions; not a clinical follow-up study"
  aggregateRole: "context"
  cohortKey: "dailymed-psyllium-husk-capsule-2026-04-26"
  notes:
    - "Directness: measurement_context"
    - "Claim use: context-only"
evidenceBucket: "Context and measurement evidence"
directness: "measurement_context"
whyItMatters: "Capsule products can require many capsules to reach cholesterol-label serving levels and have important fluid/choking warnings."
potentialMurphEndpoints:
  - "capsule dose implementation"
  - "soluble fiber amount"
  - "choking risk"
  - "allergy risk"
  - "medicine timing"
protocolTakeaway: "Use as implementation/safety context for capsule dosing and water requirements."
murphTakeaway: "Useful for practical protocol guardrails: capsules with enough water, one at a time, medication separation, and clinician input for cholesterol-lowering use."
studyDesign: "other"
modality: "capsule_label"
claimUse: "context-only"
populationMismatch: "Implementation context rather than clinical efficacy evidence."
limitations:
  - "Product label, not a trial."
  - "Label is for an OTC laxative/fiber supplement product and does not provide clinical effect estimates."
adverseEvents: "Label warns about choking if taken without adequate fluid, allergy in psyllium-sensitive people, and medication timing issues."
interventionOrExposure: "Psyllium husk capsule, approximately 0.52 g per capsule; label directions include 6 capsules for cholesterol-lowering use up to 3 times daily."
comparatorOrControl: "No comparator; product label."
durationOrFollowUp: "Label instructions; not a clinical follow-up study"
endpoints:
  - "capsule dose implementation"
  - "soluble fiber amount"
  - "choking risk"
  - "allergy risk"
  - "medicine timing"
sourceFindings:

  -
    findingId: "finding:dailymed-psyllium-husk-capsule-2026-04-26-main"
    sourceKey: "source_artifact:dailymed-psyllium-husk-capsule-2026-04-26"
    extractedFromArtifactId: "art_dailymed_psyllium_husk_capsule_2026_04_26"
    findingKind: "safety"
    population: "Consumers using OTC psyllium husk capsules."
    exposure: "Psyllium husk capsule, approximately 0.52 g per capsule; label directions include 6 capsules for cholesterol-lowering use up to 3 times daily."
    outcome: "capsule dose implementation; soluble fiber amount; choking risk; allergy risk; medicine timing"
    summary: "The DailyMed capsule label lists psyllium husk approximately 0.52 g per capsule, warns that inadequate fluid may cause swelling and choking, notes allergy risk in psyllium-sensitive people, advises taking capsules with a full glass of liquid and swallowing one at a time, and says oral prescription medicines should be taken at least 2 hours before or after the product."
    evidenceUse:
      - "safety"
      - "measurement"
      - "context"
  -
    findingId: "finding:dailymed-psyllium-husk-capsule-2026-04-26-capsule-dose-context"
    sourceKey: "source_artifact:dailymed-psyllium-husk-capsule-2026-04-26"
    extractedFromArtifactId: "art_dailymed_psyllium_husk_capsule_2026_04_26"
    findingKind: "context"
    population: "OTC psyllium capsule users."
    exposure: "Psyllium husk capsules."
    outcome: "Dose implementation"
    summary: "For increasing daily fiber intake the label gives adults 12 years and older 2-6 capsules; for cholesterol-lowering use it lists 6 capsules, up to 3 times daily, and states one serving provides 2.4 g soluble fiber from psyllium husk."
    evidenceUse:
      - "context"
      - "measurement"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
---
This source is included for **Context and measurement evidence**.

**Findings:** The DailyMed capsule label lists psyllium husk approximately 0.52 g per capsule, warns that inadequate fluid may cause swelling and choking, notes allergy risk in psyllium-sensitive people, advises taking capsules with a full glass of liquid and swallowing one at a time, and says oral prescription medicines should be taken at least 2 hours before or after the product.

**Why it matters:** Capsule products can require many capsules to reach cholesterol-label serving levels and have important fluid/choking warnings.

**Potential experiment signals:** capsule dose implementation, soluble fiber amount, choking risk, allergy risk, medicine timing.

**Protocol takeaway:** Use as implementation/safety context for capsule dosing and water requirements.

**Claim use:** `context-only`.
