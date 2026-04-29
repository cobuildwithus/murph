---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:fda-carbon-isotope-adulteration-red-yeast-rice-2021-05-26"
slug: "sources/red-yeast-rice/fda-carbon-isotope-adulteration-red-yeast-rice-2021-05-26"
title: "Using carbon isotope ratios to detect adulteration in red yeast rice supplements"
summary: "FDA Science Forum abstract describing carbon-isotope ratio testing to distinguish natural monacolin K from added pharmaceutical lovastatin in red yeast rice supplements."
status: "draft"
quality: "usable"
aliases:
  - "FDA carbon-isotope method for red yeast rice adulteration"
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
  kind: "web_page"
  title: "Using carbon isotope ratios to detect adulteration in red yeast rice supplements"
  authors: "Kristen Hannon; Kevin Kubachka; Madhavi Mantha; Lisa Lorenz; John Roetting II"
  year: 2021
  journal: "FDA Science Forum"
  citation: "Hannon K, Kubachka K, Mantha M, Lorenz L, Roetting J II. Using carbon isotope ratios to detect adulteration in red yeast rice supplements. FDA Science Forum. 2021."
  url: "https://www.fda.gov/science-research/fda-science-forum/using-carbon-isotope-ratios-detect-adulteration-red-yeast-rice-supplements"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "b777973960b422c3e5bc3d9db80fafdd217a1a0e3f53cc00a91bcecdadcb5cde"
    url: "https://www.fda.gov/science-research/fda-science-forum/using-carbon-isotope-ratios-detect-adulteration-red-yeast-rice-supplements"
  canonicalUrl: "https://www.fda.gov/science-research/fda-science-forum/using-carbon-isotope-ratios-detect-adulteration-red-yeast-rice-supplements"
researchEvidence:
  designKind: "other"
  designLabel: "Measurement-validation method"
  populationLabel: "Red yeast rice supplement samples and lovastatin standards; no human participants."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "fda-carbon-isotope-adulteration-red-yeast-rice-2021-05-26"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Supports measurement context: product labels may not reliably identify whether monacolin K is naturally present or pharmaceutical lovastatin was added."
potentialMurphEndpoints:
  - "certificate of analysis"
  - "monacolin source documentation"
  - "muscle symptoms"
  - "liver-safety symptoms"
protocolTakeaway: "Treat red yeast rice product identity as a measurement problem; hidden lovastatin can confound both efficacy and safety interpretation."
murphTakeaway: "A Murph experiment should prefer products with credible third-party chemistry documentation and should not equate label dose with exposure."
studyDesign: "Analytical method / adulteration detection"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "measurement_validation"
    population: "Red yeast rice supplement samples; no human participants"
    exposure: "Potential adulteration with pharmaceutical lovastatin"
    outcome: "Carbon isotope ratio source-attribution method"
    summary: "FDA authors described using stable carbon isotope ratios to differentiate pharmaceutical lovastatin from naturally produced monacolin K in red yeast rice supplements; the method is measurement context, not clinical efficacy evidence."
    evidenceUse:
      - "measurement"
      - "safety"
      - "context"
    findingId: "finding:fda-carbon-isotope-adulteration-red-yeast-rice-2021-05-26-isotope-adulteration-method"
    sourceKey: "source_artifact:fda-carbon-isotope-adulteration-red-yeast-rice-2021-05-26"
    extractedFromArtifactId: "art_fda_carbon_isotope_adulteration_red_yeast_rice_2021_05_26_html"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_fda_carbon_isotope_adulteration_red_yeast_rice_2021_05_26_html"
    sourceKey: "source_artifact:fda-carbon-isotope-adulteration-red-yeast-rice-2021-05-26"
    kind: "html"
    storage: "external"
    sourceUrl: "https://www.fda.gov/science-research/fda-science-forum/using-carbon-isotope-ratios-detect-adulteration-red-yeast-rice-supplements"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Red yeast rice supplement samples and lovastatin standards; no human participants."
  interventionOrExposure: "Potential addition of pharmaceutical lovastatin to red yeast rice supplements."
  comparatorOrControl: "Natural monacolin K isotope profiles reported in the literature versus lovastatin standards."
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "stable carbon isotope ratio"
    - "adulteration detection"
    - "monacolin/lovastatin source attribution"
  effectEstimatesOrDirection: "Lovastatin standards showed carbon isotope ratios distinguishable from literature values for natural monacolin K; deviations may indicate adulteration."
  adverseEventsOrSafetyNotes: "Hidden lovastatin is a safety and legality concern because it may expose consumers to statin-like risks without labeling."
  limitations: "Analytical-method abstract; does not report clinical outcomes or consumer adverse-event rates."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** FDA Science Forum abstract describing carbon-isotope ratio testing to distinguish natural monacolin K from added pharmaceutical lovastatin in red yeast rice supplements.

**Why it matters:** Supports measurement context: product labels may not reliably identify whether monacolin K is naturally present or pharmaceutical lovastatin was added.

**Potential experiment signals:** certificate of analysis, monacolin source documentation, muscle symptoms, liver-safety symptoms.

**Protocol takeaway:** Treat red yeast rice product identity as a measurement problem; hidden lovastatin can confound both efficacy and safety interpretation.

**Claim use:** `safety-only`.
