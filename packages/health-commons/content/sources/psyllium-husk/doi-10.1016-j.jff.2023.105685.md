---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1016-j.jff.2023.105685"
slug: "sources/psyllium-husk/doi-10.1016-j.jff.2023.105685"
title: "Effect of psyllium consumption on metabolic syndrome indices: Systematic review and dose-response meta-analysis of randomized controlled trials"
summary: "A 2023 dose-response synthesis focused on metabolic-syndrome indices rather than the adult LDL-C protocol question."
status: "draft"
quality: "usable"
aliases:
  - "doi:10.1016/j.jff.2023.105685"
  - "Effect of psyllium consumption on metabolic syndrome indices: Systematic review and dose-response meta-analysis of randomized controlled trials"
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
  kind: "review"
  title: "Effect of psyllium consumption on metabolic syndrome indices: Systematic review and dose-response meta-analysis of randomized controlled trials"
  authors: "Gholami Z, Paknahad Z"
  year: 2023
  journal: "Journal of Functional Foods"
  doi: "10.1016/j.jff.2023.105685"
  url: "https://www.sciencedirect.com/science/article/pii/S1756464623002852"
  citation: "Gholami Z, Paknahad Z. Effect of psyllium consumption on metabolic syndrome indices: Systematic review and dose-response meta-analysis of randomized controlled trials. Journal of Functional Foods. 2023;107:105685. doi:10.1016/j.jff.2023.105685."
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1016/j.jff.2023.105685"
    titleHash: "73de87eef64ffa98b2b7982ab29464372a757b3514eae576bd4e22308928b626"
    url: "https://www.sciencedirect.com/science/article/pii/S1756464623002852"
  canonicalUrl: "https://www.sciencedirect.com/science/article/pii/S1756464623002852"
  identityAliases:
    - "Effect of psyllium consumption on metabolic syndrome indices: Systematic review and dose-response meta-analysis of randomized controlled trials"
researchEvidence:
  designKind: "meta_analysis"
  designLabel: "Systematic review and dose-response meta-analysis of RCTs"
  populationLabel: "Participants in randomized trials reporting metabolic syndrome indices"
  durationLabel: "Varied across included trials; not extracted in this batch"
  aggregateRole: "synthesis"
  cohortKey: "doi-10.1016-j.jff.2023.105685"
  notes:
    - "Directness: adjacent_variant"
    - "Claim use: context-only"
evidenceBucket: "Adjacent variants, soluble-fiber comparators, and population mismatch"
directness: "adjacent_variant"
whyItMatters: "It may explain metabolic boundary claims, but metabolic syndrome indices are not interchangeable with psyllium monotherapy LDL-C evidence."
potentialMurphEndpoints:
  - "metabolic syndrome indices"
  - "fasting blood sugar"
  - "blood pressure"
  - "HDL-C"
  - "triglycerides"
  - "waist circumference"
protocolTakeaway: "Keep as adjacent metabolic-context evidence unless protocol authors later extract LDL-C-specific subgroup data from the full article."
murphTakeaway: "Useful for metabolic-syndrome caveats and endpoint breadth; not a direct claim source for this cholesterol protocol."
studyDesign: "meta_analysis"
modality: "dietary_supplement"
claimUse: "context-only"
populationMismatch: "Metabolic-syndrome endpoint framing rather than LDL-C-focused self-experimentation in a general adult population."
limitations:
  - "Included-study count, participant count, and LDL-C-specific estimates were not extracted in this batch."
  - "Metabolic syndrome index framing may mix lipid and non-lipid endpoints."
adverseEvents: "No adverse-event extraction available in this batch."
interventionOrExposure: "Psyllium consumption across randomized controlled trials."
comparatorOrControl: "Control or placebo arms from eligible trials."
durationOrFollowUp: "Varied across included trials; not extracted in this batch"
endpoints:
  - "metabolic syndrome indices"
  - "fasting blood sugar"
  - "blood pressure"
  - "HDL-C"
  - "triglycerides"
  - "waist circumference"
sourceFindings:
  -
    findingId: "finding:doi-10.1016-j.jff.2023.105685-main"
    sourceKey: "source_artifact:doi-10.1016-j.jff.2023.105685"
    extractedFromArtifactId: "art_doi_10_1016_j_jff_2023_105685"
    findingKind: "context"
    population: "Adults represented in trials of psyllium for metabolic-syndrome indices; exact included-trial population mix was not extracted here."
    exposure: "Psyllium consumption across randomized controlled trials."
    outcome: "metabolic syndrome indices; fasting blood sugar; blood pressure; HDL-C; triglycerides; waist circumference"
    summary: "This systematic review/meta-analysis evaluates psyllium for metabolic syndrome indices, including lipid and non-lipid cardiometabolic markers, but this batch did not extract LDL-C-specific effect estimates or included-study counts."
    evidenceUse:
      - "adjacent_variant"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
---
This source is included for **Adjacent variants, soluble-fiber comparators, and population mismatch**.

**Findings:** This systematic review/meta-analysis evaluates psyllium for metabolic syndrome indices, including lipid and non-lipid cardiometabolic markers, but this batch did not extract LDL-C-specific effect estimates or included-study counts.

**Why it matters:** It may explain metabolic boundary claims, but metabolic syndrome indices are not interchangeable with psyllium monotherapy LDL-C evidence.

**Potential experiment signals:** metabolic syndrome indices, fasting blood sugar, blood pressure, HDL-C, triglycerides, waist circumference.

**Protocol takeaway:** Keep as adjacent metabolic-context evidence unless protocol authors later extract LDL-C-specific subgroup data from the full article.

**Claim use:** `context-only`.
