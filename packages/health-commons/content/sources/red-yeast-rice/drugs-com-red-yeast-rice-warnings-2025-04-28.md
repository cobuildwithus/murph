---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:drugs-com-red-yeast-rice-warnings-2025-04-28"
slug: "sources/red-yeast-rice/drugs-com-red-yeast-rice-warnings-2025-04-28"
title: "Red yeast rice Uses, Side Effects & Warnings"
summary: "Drug-information page summarizing red yeast rice use, lack of FDA approval, manufacturing variability, statin-like side effects, pregnancy/lactation warnings, and stop-care symptoms."
status: "draft"
quality: "usable"
aliases:
  - "Drugs.com red yeast rice warnings"
  - "Red yeast rice Uses Side Effects Warnings"
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
  title: "Red yeast rice Uses, Side Effects & Warnings"
  authors: "Cerner Multum; Drugs.com medical review team"
  year: 2025
  journal: "Drugs.com"
  citation: "Cerner Multum. Red yeast rice Uses, Side Effects & Warnings. Drugs.com. Medically reviewed April 28, 2025."
  url: "https://www.drugs.com/mtm/red-yeast-rice.html"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://www.drugs.com/mtm/red-yeast-rice.html"
  canonicalUrl: "https://www.drugs.com/mtm/red-yeast-rice.html"
researchEvidence:
  designKind: "other"
  designLabel: "Consumer drug-information page"
  populationLabel: "Consumers considering red yeast rice"
  durationLabel: "Not an intervention study"
  aggregateRole: "context"
  cohortKey: "drugs-com-red-yeast-rice-warnings-2025"
evidenceBucket: "Safety reviews and pharmacovigilance"
whyItMatters: "Adds practical safety language around FDA status, variable manufacturing, pregnancy/lactation, co-use with cholesterol drugs, and urgent symptoms."
potentialMurphEndpoints:
  - "muscle symptoms"
  - "liver injury symptoms"
  - "pregnancy/lactation status"
  - "co-use with lipid-lowering drugs"
  - "product-quality uncertainty"
protocolTakeaway: "Use as safety-only consumer-warning context; do not rely on it as evidence of LDL-C effect or incidence."
murphTakeaway: "Onboarding should warn that products are not regulated like medicines and that red yeast rice can share lovastatin-like side effects and interactions."
studyDesign: "Consumer drug information"
modality: "Red yeast rice supplement safety"
directness: "same_mechanism"
claimUse: "safety-only"
claimUseBoundary: "Consumer health summary; not primary research and not a quantified incidence source."
sourceFindings:

  -
    findingId: "finding:red-yeast-rice-batch-004-drugscom-fda-quality"
    sourceKey: "source_artifact:drugs-com-red-yeast-rice-warnings-2025-04-28"
    findingKind: "context"
    population: "US consumers considering red yeast rice"
    exposure: "Commercial red yeast rice products"
    outcome: "Regulatory and quality uncertainty"
    summary: "Drugs.com states that medicinal use has not been approved by the FDA, products should not replace prescribed medication, and lack of regulated manufacturing standards can permit contamination or variable product quality."
    evidenceUse:
      - "context"
      - "safety"
  -
    findingId: "finding:red-yeast-rice-batch-004-drugscom-stop-care"
    sourceKey: "source_artifact:drugs-com-red-yeast-rice-warnings-2025-04-28"
    findingKind: "safety"
    population: "Red yeast rice users"
    exposure: "Red yeast rice supplements"
    outcome: "Muscle injury and liver-injury warning symptoms"
    summary: "The page advises stopping use and seeking medical care for unexplained muscle pain, tenderness, or weakness, fever or tiredness, nausea or upper abdominal symptoms, dark urine, or jaundice."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:red-yeast-rice-batch-004-drugscom-use-restrictions"
    sourceKey: "source_artifact:drugs-com-red-yeast-rice-warnings-2025-04-28"
    findingKind: "safety"
    population: "Consumers with medication, pregnancy, lactation, liver, or kidney considerations"
    exposure: "Red yeast rice supplements, especially with cholesterol-lowering medicines"
    outcome: "Use restrictions"
    summary: "Drugs.com warns against use with another cholesterol-lowering medication, flags liver/kidney disease for clinician review, describes pregnancy as likely unsafe, advises avoiding breastfeeding, and notes that monacolin K shares chemical structure with lovastatin."
    evidenceUse:
      - "safety"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Safety reviews and pharmacovigilance**.

**Findings:** Drugs.com states that medicinal use has not been approved by the FDA, products should not replace prescribed medication, and lack of regulated manufacturing standards can permit contamination or variable product quality.

**Why it matters:** Adds practical safety language around FDA status, variable manufacturing, pregnancy/lactation, co-use with cholesterol drugs, and urgent symptoms.

**Potential experiment signals:** muscle symptoms, liver injury symptoms, pregnancy/lactation status, co-use with lipid-lowering drugs, product-quality uncertainty.

**Protocol takeaway:** Use as safety-only consumer-warning context; do not rely on it as evidence of LDL-C effect or incidence.

**Claim use:** `safety-only`.
