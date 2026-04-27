---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clevelandclinic-red-yeast-rice-2026-04-26"
slug: "sources/red-yeast-rice/clevelandclinic-red-yeast-rice-2026-04-26"
title: "Red Yeast Rice Capsules"
summary: "Patient-facing medication/supplement page listing red yeast rice precautions, pregnancy/lactation warnings, statin-like side effects, and drug/food interactions."
status: "draft"
quality: "usable"
aliases:
  - "Cleveland Clinic red yeast rice capsules"
  - "Red yeast rice capsules Cleveland Clinic"
categories:
  - "red-yeast-rice"
  - "safety"
  - "pharmacovigilance"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "web_page"
  title: "Red Yeast Rice Capsules"
  authors: "Cleveland Clinic; Elsevier Inc."
  year: 2026
  journal: "Cleveland Clinic Health Library"
  citation: "Cleveland Clinic. Red Yeast Rice Capsules. Cleveland Clinic Health Library. Accessed April 26, 2026."
  url: "https://my.clevelandclinic.org/health/drugs/19338-red-yeast-rice-capsules"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://my.clevelandclinic.org/health/drugs/19338-red-yeast-rice-capsules"
  canonicalUrl: "https://my.clevelandclinic.org/health/drugs/19338-red-yeast-rice-capsules"
researchEvidence:
  designKind: "other"
  designLabel: "Patient drug-information page"
  populationLabel: "Consumers considering red yeast rice capsules"
  durationLabel: "Not an intervention study"
  aggregateRole: "context"
  cohortKey: "clevelandclinic-red-yeast-rice-capsules-2026"
evidenceBucket: "Safety reviews and pharmacovigilance"
whyItMatters: "Translates statin-like red yeast rice risks into practical user-facing contraindications and interaction screening."
potentialMurphEndpoints:
  - "muscle pain or weakness"
  - "liver injury symptoms"
  - "pregnancy/lactation status"
  - "medication interactions"
  - "supplement quality concerns"
protocolTakeaway: "Use only as practical safety-screening context for contraindications, interactions, and symptom stop rules."
murphTakeaway: "Before any red yeast rice trial, users need a medication and pregnancy/lactation screen plus clear stop rules for muscle and liver symptoms."
studyDesign: "Patient education / drug information"
modality: "Red yeast rice capsules"
directness: "same_mechanism"
claimUse: "safety-only"
claimUseBoundary: "Consumer information page; not primary research and not efficacy evidence."
sourceFindings:
  -
    findingId: "finding:red-yeast-rice-batch-004-clevelandclinic-contraindications"
    sourceKey: "source_artifact:clevelandclinic-red-yeast-rice-2026-04-26"
    findingKind: "safety"
    population: "Consumers considering red yeast rice capsules"
    exposure: "Red yeast rice capsules"
    outcome: "Contraindications and caution conditions"
    summary: "The page advises clinician discussion before use in people with alcohol use, kidney disease, liver disease, muscle aches or weakness, allergy to lovastatin/statins, pregnancy, or breastfeeding."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:red-yeast-rice-batch-004-clevelandclinic-interactions"
    sourceKey: "source_artifact:clevelandclinic-red-yeast-rice-2026-04-26"
    findingKind: "safety"
    population: "Consumers taking prescription or OTC medications"
    exposure: "Red yeast rice plus interacting drugs or grapefruit/alcohol"
    outcome: "Interaction risk"
    summary: "Cleveland Clinic lists do-not-combine or caution interactions including macrolides, azole antifungals, protease inhibitors, grapefruit, other cholesterol medications, alcohol, amiodarone, colchicine, cyclosporine, danazol, fibrates/gemfibrozil, niacin, warfarin, and other agents."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:red-yeast-rice-batch-004-clevelandclinic-stop-symptoms"
    sourceKey: "source_artifact:clevelandclinic-red-yeast-rice-2026-04-26"
    findingKind: "safety"
    population: "Red yeast rice users"
    exposure: "Red yeast rice capsules"
    outcome: "Muscle injury, liver injury, and quality variability"
    summary: "The page warns users to seek care for unexplained muscle pain, tenderness, or weakness with fever or tiredness, notes possible liver injury and muscle injury, and states supplement purity and strength may vary."
    evidenceUse:
      - "safety"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Safety reviews and pharmacovigilance**.

**Findings:** The page advises clinician discussion before use in people with alcohol use, kidney disease, liver disease, muscle aches or weakness, allergy to lovastatin/statins, pregnancy, or breastfeeding.

**Why it matters:** Translates statin-like red yeast rice risks into practical user-facing contraindications and interaction screening.

**Potential experiment signals:** muscle pain or weakness, liver injury symptoms, pregnancy/lactation status, medication interactions, supplement quality concerns.

**Protocol takeaway:** Use only as practical safety-screening context for contraindications, interactions, and symptom stop rules.

**Claim use:** `safety-only`.
