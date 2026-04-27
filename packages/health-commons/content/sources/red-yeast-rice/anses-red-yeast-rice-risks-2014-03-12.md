---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:anses-red-yeast-rice-risks-2014-03-12"
slug: "sources/red-yeast-rice/anses-red-yeast-rice-risks-2014-03-12"
title: "Opinion of the French Agency for Food, Environmental and Occupational Health & Safety on the risks associated with the presence of “red yeast rice” in food supplements"
summary: "French agency safety opinion based on nutrivigilance reports and literature, warning that red yeast rice supplements can cause statin-like muscle and liver reactions and that monacolin/citrinin product quality is uncertain."
status: "draft"
quality: "usable"
aliases:
  - "ANSES red yeast rice risks 2014"
  - "French red yeast rice food supplement opinion"
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
  title: "Opinion of the French Agency for Food, Environmental and Occupational Health & Safety on the risks associated with the presence of “red yeast rice” in food supplements"
  authors: "ANSES (French Agency for Food, Environmental and Occupational Health & Safety)"
  year: 2014
  journal: "ANSES Opinion"
  citation: "ANSES. Opinion of the French Agency for Food, Environmental and Occupational Health & Safety on the risks associated with the presence of “red yeast rice” in food supplements. Published March 12, 2014."
  url: "https://www.anses.fr/en/content/opinion-french-agency-food-environmental-and-occupational-health-safety-risks-associated-0"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://www.anses.fr/en/content/opinion-french-agency-food-environmental-and-occupational-health-safety-risks-associated-0"
  canonicalUrl: "https://www.anses.fr/en/content/opinion-french-agency-food-environmental-and-occupational-health-safety-risks-associated-0"
researchEvidence:
  designKind: "guideline"
  designLabel: "Agency safety opinion with nutrivigilance case review"
  participantCount: 25
  participantCountKind: "reported"
  populationLabel: "French nutrivigilance reports; 30 reports received since 2009, 25 complete enough for analysis"
  durationLabel: "Reports since 2009 plus literature reviewed for 2014 opinion"
  aggregateRole: "context"
  cohortKey: "anses-2014-red-yeast-rice-risk-opinion"
  aggregationNote: "Participant count reflects analyzable nutrivigilance reports, not a denominator for incidence."
evidenceBucket: "Safety reviews and pharmacovigilance"
whyItMatters: "Adds national nutrivigilance and consumer-protection framing for product variability, vulnerable users, and medical supervision."
potentialMurphEndpoints:
  - "muscle symptoms"
  - "liver enzymes"
  - "kidney-risk screening"
  - "drug and grapefruit interactions"
  - "citrinin/product-quality checks"
protocolTakeaway: "Use as a safety boundary: consumers should seek health-professional guidance, avoid co-use with statins/lipid drugs, and avoid red yeast rice in vulnerable groups."
murphTakeaway: "A protocol should ask about statin intolerance, liver/kidney/muscle disease, age, pregnancy/lactation, alcohol, grapefruit, and lipid-lowering medication before any self-experiment."
studyDesign: "Regulatory safety opinion and nutrivigilance review"
modality: "Red yeast rice food supplements"
directness: "general_guideline"
claimUse: "safety-only"
claimUseBoundary: "Safety and product-quality guidance only; do not infer population incidence from nutrivigilance counts."
sourceFindings:
  -
    findingId: "finding:red-yeast-rice-batch-004-anses-2014-statins-like-risk"
    sourceKey: "source_artifact:anses-red-yeast-rice-risks-2014-03-12"
    findingKind: "safety"
    population: "Consumers of red yeast rice food supplements, including 25 analyzable French nutrivigilance reports"
    exposure: "Food supplements containing red yeast rice and monacolin K"
    outcome: "Muscle and liver adverse reactions; vulnerable-group risk"
    summary: "ANSES concluded that red yeast rice can cause the same types of adverse reactions as statins, primarily muscle and liver reactions, and highlighted higher-risk situations including pregnancy/lactation, children/adolescents, older adults, kidney failure, muscle disease, untreated hypothyroidism, statin intolerance, alcohol, grapefruit, and lipid-lowering medications."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:red-yeast-rice-batch-004-anses-2014-product-variability"
    sourceKey: "source_artifact:anses-red-yeast-rice-risks-2014-03-12"
    findingKind: "context"
    population: "Commercial red yeast rice supplement users"
    exposure: "Variable red yeast rice supplement formulations"
    outcome: "Monacolin uncertainty and citrinin contamination risk"
    summary: "ANSES emphasized that monacolin composition and actual levels in marketed products are highly variable or unknown and that products may contain citrinin, a genotoxic mycotoxin requiring systematic controls."
    evidenceUse:
      - "context"
      - "safety"
  -
    findingId: "finding:red-yeast-rice-batch-004-anses-2014-monitoring-recommendation"
    sourceKey: "source_artifact:anses-red-yeast-rice-risks-2014-03-12"
    findingKind: "safety"
    population: "People considering red yeast rice for cholesterol lowering"
    exposure: "Red yeast rice food supplements used with or without medical advice"
    outcome: "Medical-supervision recommendation"
    summary: "ANSES recommended health-professional advice, liver-function assessment/monitoring, statin-like precautions and contraindications, and warned that red yeast rice is not an alternative to cholesterol-lowering medication."
    evidenceUse:
      - "safety"
      - "context"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---
This source is included for **Safety reviews and pharmacovigilance**.

**Findings:** ANSES concluded that red yeast rice can cause the same types of adverse reactions as statins, primarily muscle and liver reactions, and highlighted higher-risk situations including pregnancy/lactation, children/adolescents, older adults, kidney failure, muscle disease, untreated hypothyroidism, statin intolerance, alcohol, grapefruit, and lipid-lowering medications.

**Why it matters:** Adds national nutrivigilance and consumer-protection framing for product variability, vulnerable users, and medical supervision.

**Potential experiment signals:** muscle symptoms, liver enzymes, kidney-risk screening, drug and grapefruit interactions, citrinin/product-quality checks.

**Protocol takeaway:** Use as a safety boundary: consumers should seek health-professional guidance, avoid co-use with statins/lipid drugs, and avoid red yeast rice in vulnerable groups.

**Claim use:** `safety-only`.
