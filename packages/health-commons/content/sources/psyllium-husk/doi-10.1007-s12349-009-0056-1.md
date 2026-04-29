---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1007-s12349-009-0056-1"
slug: "sources/psyllium-husk/doi-10.1007-s12349-009-0056-1"
title: "Psyllium improves dyslipidaemia, hyperglycaemia and hypertension, while guar gum reduces body weight more rapidly in patients affected by metabolic syndrome following an AHA Step 2 diet"
summary: "Controlled metabolic-syndrome diet-therapy source comparing psyllium and guar gum; it is useful for separating metabolic-syndrome context from adult LDL-C monotherapy claims."
status: "draft"
quality: "usable"
aliases:
  - "doi:10.1007/s12349-009-0056-1"
  - "Psyllium improves dyslipidaemia, hyperglycaemia and hypertension, while guar gum reduces body weight more rapidly in patients affected by metabolic syndrome following an AHA Step 2 diet"
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
  kind: "journal_article"
  title: "Psyllium improves dyslipidaemia, hyperglycaemia and hypertension, while guar gum reduces body weight more rapidly in patients affected by metabolic syndrome following an AHA Step 2 diet"
  authors: "Cicero AFG, Derosa G, Bove M, Imola F, Borghi C, Gaddi AV"
  year: 2010
  journal: "Mediterranean Journal of Nutrition and Metabolism"
  doi: "10.1007/s12349-009-0056-1"
  url: "https://link.springer.com/article/10.1007/s12349-009-0056-1"
  citation: "Cicero AFG, Derosa G, Bove M, Imola F, Borghi C, Gaddi AV. Psyllium improves dyslipidaemia, hyperglycaemia and hypertension, while guar gum reduces body weight more rapidly in patients affected by metabolic syndrome following an AHA Step 2 diet. Mediterranean Journal of Nutrition and Metabolism. 2010;3:47-54. doi:10.1007/s12349-009-0056-1."
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1007/s12349-009-0056-1"
    titleHash: "7dd8cec675b4f1de3a6b1db91963ab84fbaa87b35414a0ce8a855c4cd17f416d"
    url: "https://link.springer.com/article/10.1007/s12349-009-0056-1"
  canonicalUrl: "https://link.springer.com/article/10.1007/s12349-009-0056-1"
  identityAliases:
    - "Psyllium improves dyslipidaemia, hyperglycaemia and hypertension, while guar gum reduces body weight more rapidly in patients affected by metabolic syndrome following an AHA Step 2 diet"
researchEvidence:
  designKind: "controlled_trial"
  designLabel: "Controlled diet-therapy comparison"
  populationLabel: "Patients with metabolic syndrome following an AHA Step 2 diet"
  durationLabel: "Not extracted in this batch"
  aggregateRole: "context"
  cohortKey: "doi-10.1007-s12349-009-0056-1"
  notes:
    - "Directness: adjacent_variant"
    - "Claim use: context-only"
evidenceBucket: "Adjacent variants, soluble-fiber comparators, and population mismatch"
directness: "adjacent_variant"
whyItMatters: "The source sits near psyllium cholesterol evidence but is driven by metabolic syndrome and diet-therapy context, so it should not be used as direct monotherapy proof for this protocol."
potentialMurphEndpoints:
  - "dyslipidaemia"
  - "hyperglycaemia"
  - "hypertension"
  - "body weight"
protocolTakeaway: "Use only as adjacent metabolic-syndrome context; no LDL-C effect size was extracted for direct protocol claims in this batch."
murphTakeaway: "Useful for caveats about metabolic comorbidity and soluble-fiber comparators, not for estimating the expected LDL-C effect of a psyllium-only experiment."
studyDesign: "controlled_trial"
modality: "dietary_supplement_and_diet_therapy"
claimUse: "context-only"
populationMismatch: "Metabolic syndrome and diet-therapy context rather than a general adult cholesterol-lowering psyllium-husk protocol."
limitations:
  - "Metabolic-syndrome population and multiple cardiometabolic endpoints."
  - "Effect sizes and participant count were not extracted from accessible abstract-level material in this batch."
  - "The record compares soluble-fiber variants rather than isolating psyllium as the only intervention."
adverseEvents: "No adverse-event details were extracted in this batch."
interventionOrExposure: "Psyllium in the context of AHA Step 2 diet therapy; guar gum was a soluble-fiber comparator."
comparatorOrControl: "Guar gum and/or diet-therapy context as described by the article title and discovery record."
durationOrFollowUp: "Not extracted in this batch"
endpoints:
  - "dyslipidaemia"
  - "hyperglycaemia"
  - "hypertension"
  - "body weight"
sourceFindings:

  -
    findingId: "finding:doi-10.1007-s12349-009-0056-1-main"
    sourceKey: "source_artifact:doi-10.1007-s12349-009-0056-1"
    extractedFromArtifactId: "art_doi_10_1007_s12349_009_0056_1"
    findingKind: "intervention_result"
    population: "Patients affected by metabolic syndrome; lipid, glucose, blood-pressure, and weight endpoints were all relevant to the report."
    exposure: "Psyllium in the context of AHA Step 2 diet therapy; guar gum was a soluble-fiber comparator."
    outcome: "dyslipidaemia; hyperglycaemia; hypertension; body weight"
    summary: "In patients with metabolic syndrome following an AHA Step 2 diet, the article frames psyllium as improving dyslipidaemia, hyperglycaemia, and hypertension while guar gum reduced body weight more rapidly. No participant count or LDL-C effect estimate was extracted here, so the source remains adjacent context."
    evidenceUse:
      - "adjacent_variant"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "permission_required"
---
This source is included for **Adjacent variants, soluble-fiber comparators, and population mismatch**.

**Findings:** In patients with metabolic syndrome following an AHA Step 2 diet, the article frames psyllium as improving dyslipidaemia, hyperglycaemia, and hypertension while guar gum reduced body weight more rapidly. No participant count or LDL-C effect estimate was extracted here, so the source remains adjacent context.

**Why it matters:** The source sits near psyllium cholesterol evidence but is driven by metabolic syndrome and diet-therapy context, so it should not be used as direct monotherapy proof for this protocol.

**Potential experiment signals:** dyslipidaemia, hyperglycaemia, hypertension, body weight.

**Protocol takeaway:** Use only as adjacent metabolic-syndrome context; no LDL-C effect size was extracted for direct protocol claims in this batch.

**Claim use:** `context-only`.
