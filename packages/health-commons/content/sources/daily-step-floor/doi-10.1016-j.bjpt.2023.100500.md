---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-j.bjpt.2023.100500
slug: sources/daily-step-floor/doi-10.1016-j.bjpt.2023.100500
title: 'Consensus-based recommendations on physical activity and exercise in patients with diabetes at risk of foot ulcerations: a Delphi study'
summary: Delphi recommendations frame diabetic-foot-risk activity as a supervised safety boundary.
status: draft
quality: usable
aliases:
- doi-10.1016-j.bjpt.2023.100500
- doi:10.1016/j.bjpt.2023.100500
- PMC10201453
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: 'Consensus-based recommendations on physical activity and exercise in patients with diabetes at risk of foot ulcerations: a Delphi study'
  authors: Gracia-Sánchez A; López-Pineda A; Lázaro-Martínez JL; Pérez A; Pomares-Gómez FJ; Fernández-Seguín LM; Gil-Guillén VF; Chicharro-Luna E
  year: 2023
  journal: Brazilian Journal of Physical Therapy
  doi: 10.1016/j.bjpt.2023.100500
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC10201453
  citation: 'Gracia-Sánchez A et al. Consensus-based recommendations on physical activity and exercise in patients with diabetes at risk of foot ulcerations: a Delphi study. Brazilian Journal of Physical Therapy. 2023. doi:10.1016/j.bjpt.2023.100500 PMCID:PMC10201453'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC10201453
    doi: 10.1016/j.bjpt.2023.100500
    titleHash: ad743d5beee232208cf357de4368b735a26b28f0280edc3cfd70491d2d01de2d
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC10201453
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC10201453
researchEvidence:
  designKind: expert_protocol
  designLabel: Three-round Delphi consensus study
  populationLabel: International/multidisciplinary experts making recommendations for people with diabetes at risk of foot ulceration
  durationLabel: Three Delphi rounds; no participant follow-up intervention.
  cohortKey: doi-10-1016-j-bjpt-2023-100500
  participantCount: 29
  participantCountKind: reported
  aggregateRole: context
evidenceBucket: safety_special_populations
sourceKind: journal_article
population: People with diabetes at risk of foot ulcerations; Delphi respondents were diabetic-foot/physical-activity experts.
interventionOrExposure: Consensus recommendations on physical activity and exercise, including foot protection, exercise type, activity return after ulceration, and monitoring.
comparatorOrControl: Consensus thresholds across Delphi rounds; no clinical comparator.
endpoints:
- physical-activity recommendations
- exercise recommendations
- foot protection
- foot-ulcer risk management
- return-to-activity guidance
limitations:
- Consensus recommendations rather than a clinical trial; does not estimate Daily Step Floor efficacy or adverse-event rates.
adverseEventsOrSafety: Safety-focused recommendations emphasize foot examination, appropriate footwear/insoles/socks, monitoring, and adapting or avoiding weight-bearing activity in higher-risk or actively ulcerated feet under professional supervision.
populationMismatch: Diabetes foot-ulcer-risk population; applies as a safety boundary, not as general adult step-floor evidence.
directness: clinical_supervised
directnessToDailyStepFloor: clinical_supervised safety boundary for diabetic-foot risk
whyItMatters: Provides practical safety boundaries for step goals in people with diabetes who are at risk of foot ulceration.
potentialMurphEndpoints:
- daily-step-count
- foot-ulcer symptoms
- footwear/offloading adherence
- musculoskeletal pain
- adverse-events
protocolTakeaway: Daily Step Floor should not treat diabetic-foot-risk users as routine users; step goals need foot checks, protective footwear/offloading, and clinician-supervised modifications.
murphTakeaway: Use as safety-only evidence for diabetic-foot risk screening, escalation, and off-ramp language.
studyDesign: Delphi consensus study
modality: Diabetes foot-risk physical activity and exercise recommendations
claimUse: safety-only
sourceFindings:
- findingId: finding:doi-10-1016-j-bjpt-2023-100500:diabetic-foot-consensus-safety
  sourceKey: source_artifact:doi-10.1016-j.bjpt.2023.100500
  extractedFromArtifactId: art_doi_10_1016_j_bjpt_2023_100500_pmc_fulltext
  findingKind: safety
  population: People with diabetes at risk of foot ulcerations; Delphi respondents were diabetic-foot/physical-activity experts.
  exposure: Consensus recommendations on physical activity and exercise, including foot protection, exercise type, activity return after ulceration, and monitoring.
  outcome: physical-activity recommendations; exercise recommendations; foot protection; foot-ulcer risk management; return-to-activity guidance
  summary: A Delphi expert panel produced consensus recommendations for physical activity and exercise in people with diabetes at risk of foot ulceration, emphasizing foot protection, monitoring, exercise selection, and supervised return to activity rather than unrestricted step targets.
  evidenceUse:
  - safety
  - context
murphV1Priority: High
pdfRightsStatus: open_access
artifacts:
- artifactId: art_doi_10_1016_j_bjpt_2023_100500_pmc_fulltext
  kind: html
  storage: external
  rightsStatus: open_access
  redistributable: false
  sourceKey: source_artifact:doi-10.1016-j.bjpt.2023.100500
  sourceUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC10201453
  contentType: text/html
  accessNotes: 'Open-access source according to batch rights guess; no PDF binary stored in Git. Rights-safe draft: no PDF or copyrighted full text is committed; redistributability remains false until rights review, checksum capture, and approved storage.'
---

This source is included for **safety_special_populations**.

**Findings:** A Delphi expert panel produced consensus recommendations for physical activity and exercise in people with diabetes at risk of foot ulceration, emphasizing foot protection, monitoring, exercise selection, and supervised return to activity rather than unrestricted step targets.

**Why it matters:** Provides practical safety boundaries for step goals in people with diabetes who are at risk of foot ulceration.

**Potential experiment signals:** daily-step-count, foot-ulcer symptoms, footwear/offloading adherence, musculoskeletal pain, adverse-events.

**Protocol takeaway:** Daily Step Floor should not treat diabetic-foot-risk users as routine users; step goals need foot checks, protective footwear/offloading, and clinician-supervised modifications.

**Claim use:** `safety-only`.

**Directness boundary:** clinical_supervised safety boundary for diabetic-foot risk. Do not promote this source into direct Daily Step Floor claims beyond the stated claim-use boundary.

**Safety/adverse events:** Safety-focused recommendations emphasize foot examination, appropriate footwear/insoles/socks, monitoring, and adapting or avoiding weight-bearing activity in higher-risk or actively ulcerated feet under professional supervision.

**Limitations and mismatch:** Consensus recommendations rather than a clinical trial; does not estimate Daily Step Floor efficacy or adverse-event rates. Diabetes foot-ulcer-risk population; applies as a safety boundary, not as general adult step-floor evidence.
