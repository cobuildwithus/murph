---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.2903-j.efsa.2015.4102
slug: sources/caffeine-timing/doi-10.2903-j.efsa.2015.4102
title: Scientific Opinion on the safety of caffeine
summary: EFSA scientific opinion providing all-source caffeine safety reference values and a sleep-timing caution for caffeine close to bedtime.
status: draft
quality: usable
aliases:
- EFSA safety of caffeine
- EFSA Journal 2015 caffeine safety
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: guideline
  title: Scientific Opinion on the safety of caffeine
  authors: EFSA Panel on Dietetic Products, Nutrition and Allergies (NDA)
  year: 2015
  journal: EFSA Journal
  citation: EFSA NDA Panel. Scientific Opinion on the safety of caffeine. EFSA Journal. 2015;13(5):4102. doi:10.2903/j.efsa.2015.4102.
  doi: 10.2903/j.efsa.2015.4102
  url: https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2015.4102
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.2903/j.efsa.2015.4102
    titleHash: 9b016ffd8c7a3e69f191c5c8b8c395d0c3f850574c10f840532da5dca5845e7a
    url: https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2015.4102
  canonicalUrl: https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2015.4102
researchEvidence:
  designKind: guideline
  designLabel: Scientific safety opinion
  populationLabel: General healthy population; pregnancy/lactation; children/adolescents
  durationLabel: Safety assessment across acute and habitual intake
  aggregateRole: primary
  cohortKey: doi-10.2903-j.efsa.2015.4102
evidenceBucket: clinical_safety_boundaries
whyItMatters: This is a high-authority safety anchor for maximum-dose guardrails and for distinguishing sleep timing cautions from direct protocol efficacy evidence.
potentialMurphEndpoints:
- biomarker:caffeine-dose
- biomarker:sleep-onset-latency
- biomarker:sleep-duration
- biomarker:pregnancy-outcomes
- biomarker:infant-sleep
protocolTakeaway: Use EFSA as safety-boundary context for daily dose caps and close-to-bedtime caffeine cautions; do not present it as a test of the 14-day curfew reset.
murphTakeaway: Strong source for all-source dose auditing, pregnancy/lactation caveats, and bedtime-caffeine risk language.
studyDesign: Scientific safety opinion
modality: caffeine safety boundary
claimUse: safety-only
limitations:
- Safety opinion aggregates heterogeneous evidence; it is not a direct trial of no caffeine after 10-11am or within 8 hours of bedtime.
populationMismatch: Safety reference values apply to broad populations and not specifically to self-tracking adults running a 14-day timing reset.
directnessToProtocol: general_guideline
sourceFindings:
- findingId: finding:doi-10.2903-j.efsa.2015.4102-01
  sourceKey: source_artifact:doi-10.2903-j.efsa.2015.4102
  extractedFromArtifactId: art_doi_10_2903_j_efsa_2015_4102_html
  findingKind: safety
  population: Healthy nonpregnant adults
  exposure: Caffeine from all dietary sources
  outcome: Single-dose and daily safety reference values
  summary: EFSA concluded that single caffeine doses up to 200 mg and habitual intakes up to 400 mg/day do not raise safety concerns for healthy nonpregnant adults.
  evidenceUse:
  - safety
- findingId: finding:doi-10.2903-j.efsa.2015.4102-02
  sourceKey: source_artifact:doi-10.2903-j.efsa.2015.4102
  extractedFromArtifactId: art_doi_10_2903_j_efsa_2015_4102_html
  findingKind: safety
  population: Pregnant or lactating people
  exposure: Caffeine from all dietary sources
  outcome: Pregnancy/lactation intake boundary
  summary: EFSA concluded that habitual caffeine intakes up to 200 mg/day do not raise safety concerns for the fetus in pregnancy or the breastfed infant during lactation.
  evidenceUse:
  - safety
- findingId: finding:doi-10.2903-j.efsa.2015.4102-03
  sourceKey: source_artifact:doi-10.2903-j.efsa.2015.4102
  extractedFromArtifactId: art_doi_10_2903_j_efsa_2015_4102_html
  findingKind: adverse_event
  population: Adults, children, and adolescents
  exposure: Caffeine near bedtime
  outcome: Sleep latency and sleep duration
  summary: EFSA noted that caffeine doses around 100 mg in adults, or approximately 1.4-1.5 mg/kg body weight in children/adolescents, may increase sleep latency and reduce sleep duration, especially when consumed close to bedtime.
  evidenceUse:
  - safety
  - context
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **clinical_safety_boundaries**.

**Findings:**
- `finding:doi-10.2903-j.efsa.2015.4102-01`: EFSA concluded that single caffeine doses up to 200 mg and habitual intakes up to 400 mg/day do not raise safety concerns for healthy nonpregnant adults.
- `finding:doi-10.2903-j.efsa.2015.4102-02`: EFSA concluded that habitual caffeine intakes up to 200 mg/day do not raise safety concerns for the fetus in pregnancy or the breastfed infant during lactation.
- `finding:doi-10.2903-j.efsa.2015.4102-03`: EFSA noted that caffeine doses around 100 mg in adults, or approximately 1.4-1.5 mg/kg body weight in children/adolescents, may increase sleep latency and reduce sleep duration, especially when consumed close to bedtime.

**Why it matters:** This is a high-authority safety anchor for maximum-dose guardrails and for distinguishing sleep timing cautions from direct protocol efficacy evidence.

**Potential experiment signals:**
- biomarker:caffeine-dose
- biomarker:sleep-onset-latency
- biomarker:sleep-duration
- biomarker:pregnancy-outcomes
- biomarker:infant-sleep

**Protocol takeaway:** Use EFSA as safety-boundary context for daily dose caps and close-to-bedtime caffeine cautions; do not present it as a test of the 14-day curfew reset.

**Claim use:** `safety-only`.
