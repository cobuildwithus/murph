---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:eur-lex-regulation-2019-1901-citrinin-red-yeast-rice-2019-11-07"
slug: "sources/red-yeast-rice/eur-lex-regulation-2019-1901-citrinin-red-yeast-rice-2019-11-07"
title: "Commission Regulation (EU) 2019/1901 of 7 November 2019 amending Regulation (EC) No 1881/2006 as regards maximum levels of citrinin in food supplements"
summary: "EU contaminant regulation lowering the maximum citrinin level for food supplements based on rice fermented with red yeast Monascus purpureus."
status: "draft"
quality: "usable"
aliases:
  - "EU 2019 citrinin limit for red yeast rice supplements"
categories:
  - "red-yeast-rice"
  - "regulatory"
  - "safety"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "guideline"
  title: "Commission Regulation (EU) 2019/1901 of 7 November 2019 amending Regulation (EC) No 1881/2006 as regards maximum levels of citrinin in food supplements"
  authors: "European Commission"
  year: 2019
  journal: "Official Journal of the European Union"
  citation: "European Commission. Commission Regulation (EU) 2019/1901 of 7 November 2019 amending Regulation (EC) No 1881/2006 as regards maximum levels of citrinin in food supplements. Official Journal of the European Union. 2019."
  url: "https://eur-lex.europa.eu/eli/reg/2019/1901/oj/eng"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "0834b28714ae8ee3c1d5128a294a24dd6334940fad99862f11c481c443b280de"
    url: "https://eur-lex.europa.eu/eli/reg/2019/1901/oj/eng"
  canonicalUrl: "https://eur-lex.europa.eu/eli/reg/2019/1901/oj/eng"
researchEvidence:
  designKind: "guideline"
  designLabel: "Regulation / contaminant limit"
  populationLabel: "Food supplements based on rice fermented with red yeast Monascus purpureus placed on the EU market."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "eur-lex-regulation-2019-1901-citrinin-red-yeast-rice-2019-11-07"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Defines an EU product-quality safety boundary: citrinin contamination must be treated as a required safety screen for red yeast rice products."
potentialMurphEndpoints:
  - "citrinin test status"
  - "kidney-safety symptoms"
  - "product certificate of analysis"
protocolTakeaway: "Use only as a safety and sourcing boundary; it does not support an LDL-lowering claim."
murphTakeaway: "Red yeast rice experiments should log product quality and citrinin-testing status because contaminant limits are a jurisdictional safety requirement, not a performance endpoint."
studyDesign: "Regulation / contaminant limit"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "safety"
    population: "EU food supplements based on rice fermented with red yeast Monascus purpureus"
    exposure: "Citrinin in red yeast rice food supplements"
    outcome: "Regulatory maximum level / contaminant boundary"
    summary: "Commission Regulation (EU) 2019/1901 lowered the EU maximum citrinin level for food supplements based on rice fermented with red yeast Monascus purpureus, making citrinin testing a safety and quality boundary rather than efficacy evidence."
    evidenceUse:
      - "safety"
      - "context"
    findingId: "finding:eur-lex-regulation-2019-1901-citrinin-red-yeast-rice-2019-11-07-citrinin-limit"
    sourceKey: "source_artifact:eur-lex-regulation-2019-1901-citrinin-red-yeast-rice-2019-11-07"
    extractedFromArtifactId: "art_eur_lex_regulation_2019_1901_citrinin_red_yeast_rice_2019_11_07_pdf"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_eur_lex_regulation_2019_1901_citrinin_red_yeast_rice_2019_11_07_pdf"
    sourceKey: "source_artifact:eur-lex-regulation-2019-1901-citrinin-red-yeast-rice-2019-11-07"
    kind: "pdf"
    storage: "external"
    sourceUrl: "https://eur-lex.europa.eu/eli/reg/2019/1901/oj/eng"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Food supplements based on rice fermented with red yeast Monascus purpureus placed on the EU market."
  interventionOrExposure: "Citrinin contamination in red yeast rice food supplements."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "citrinin contamination"
    - "kidney-safety context"
    - "product quality"
  effectEstimatesOrDirection: "Sets a lower legal maximum level for citrinin in red-yeast-rice food supplements; no cholesterol efficacy endpoint is tested."
  adverseEventsOrSafetyNotes: "Citrinin is handled as a contaminant safety concern; the regulation focuses on risk reduction rather than adverse-event estimation."
  limitations: "Regulatory contaminant standard; does not measure LDL-C outcomes, monacolin dose-response, or real-world adverse-event rates."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** EU contaminant regulation lowering the maximum citrinin level for food supplements based on rice fermented with red yeast Monascus purpureus.

**Why it matters:** Defines an EU product-quality safety boundary: citrinin contamination must be treated as a required safety screen for red yeast rice products.

**Potential experiment signals:** citrinin test status, kidney-safety symptoms, product certificate of analysis.

**Protocol takeaway:** Use only as a safety and sourcing boundary; it does not support an LDL-lowering claim.

**Claim use:** `safety-only`.
