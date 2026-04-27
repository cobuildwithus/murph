---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:tga-red-yeast-rice-schedule-4-2009-10-20"
slug: "sources/red-yeast-rice/tga-red-yeast-rice-schedule-4-2009-10-20"
title: "National Drugs and Poisons Schedule Committee Record of Reasons, 20 October 2009"
summary: "Australian NDPSC record deciding to create a Schedule 4 entry for red yeast rice for human therapeutic use, citing statin-like action, safety/interactions, lack of standardization, and need for medical supervision."
status: "draft"
quality: "usable"
aliases:
  - "TGA NDPSC 2009 Schedule 4 red yeast rice record of reasons"
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
  title: "National Drugs and Poisons Schedule Committee Record of Reasons, 20 October 2009"
  authors: "National Drugs and Poisons Schedule Committee / Therapeutic Goods Administration Australia"
  year: 2009
  journal: "TGA National Drugs and Poisons Schedule Committee record"
  citation: "National Drugs and Poisons Schedule Committee. Record of Reasons of Meeting 57 - October 2009. Therapeutic Goods Administration. 2009."
  url: "https://www.tga.gov.au/sites/default/files/ndpsc-record-57.pdf"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "39ed890f54dc10e3eec41aad3ae513b9dae1e8a5492d93862f6aa714a12106f7"
    url: "https://www.tga.gov.au/sites/default/files/ndpsc-record-57.pdf"
  canonicalUrl: "https://www.tga.gov.au/sites/default/files/ndpsc-record-57.pdf"
researchEvidence:
  designKind: "guideline"
  designLabel: "Scheduling decision record"
  populationLabel: "Australian regulatory context for red yeast rice for human therapeutic use."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "tga-red-yeast-rice-schedule-4-2009-10-20"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Adds Australia-specific jurisdictional boundary and reinforces medical-supervision concerns for therapeutic red yeast rice use."
potentialMurphEndpoints:
  - "jurisdiction"
  - "medical supervision status"
  - "muscle symptoms"
  - "liver safety"
  - "pregnancy/lactation exclusion"
protocolTakeaway: "Protocol guidance must be jurisdiction-specific; therapeutic use can be regulated as prescription-only in Australia."
murphTakeaway: "A self-experiment protocol cannot assume OTC legality or safety in all countries."
studyDesign: "Scheduling decision record"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingKind: "safety"
    population: "Australian regulatory context for red yeast rice for human therapeutic use"
    exposure: "Red yeast rice with monacolins/lovastatin-like activity"
    outcome: "Schedule 4 scheduling decision"
    summary: "The Australian NDPSC decided to create a Schedule 4 entry for red yeast rice for human therapeutic use, citing statin-like activity, lack of standardization, adverse-event concerns, interactions, pregnancy/lactation concerns, and the need for medical supervision."
    evidenceUse:
      - "safety"
      - "context"
    findingId: "finding:tga-red-yeast-rice-schedule-4-2009-10-20-schedule-4-therapeutic-use"
    sourceKey: "source_artifact:tga-red-yeast-rice-schedule-4-2009-10-20"
    extractedFromArtifactId: "art_tga_red_yeast_rice_schedule_4_2009_10_20_pdf"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:
  -
    artifactId: "art_tga_red_yeast_rice_schedule_4_2009_10_20_pdf"
    sourceKey: "source_artifact:tga-red-yeast-rice-schedule-4-2009-10-20"
    kind: "pdf"
    storage: "external"
    sourceUrl: "https://www.tga.gov.au/sites/default/files/ndpsc-record-57.pdf"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Australian regulatory context for red yeast rice for human therapeutic use."
  interventionOrExposure: "Red yeast rice containing monacolins/lovastatin-like HMG-CoA reductase inhibitors."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "Schedule 4 status"
    - "medical supervision need"
    - "myopathy/rhabdomyolysis/liver-function concerns"
    - "standardization concerns"
  effectEstimatesOrDirection: "The Committee decided to create a Schedule 4 entry: “RED YEAST RICE for human therapeutic use.”"
  adverseEventsOrSafetyNotes: "The record cites concerns including myopathy, abnormal liver function, rhabdomyolysis, interactions, pregnancy/lactation, and lack of standardized RYR preparations."
  limitations: "Regulatory decision record; contains cited evidence summaries and committee reasoning but no new clinical trial."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** Australian NDPSC record deciding to create a Schedule 4 entry for red yeast rice for human therapeutic use, citing statin-like action, safety/interactions, lack of standardization, and need for medical supervision.

**Why it matters:** Adds Australia-specific jurisdictional boundary and reinforces medical-supervision concerns for therapeutic red yeast rice use.

**Potential experiment signals:** jurisdiction, medical supervision status, muscle symptoms, liver safety, pregnancy/lactation exclusion.

**Protocol takeaway:** Protocol guidance must be jurisdiction-specific; therapeutic use can be regulated as prescription-only in Australia.

**Claim use:** `safety-only`.
