---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:va-dod-substance-use-disorder-guideline-2021-08-02
slug: sources/alcohol-abstinence/va-dod-substance-use-disorder-guideline-2021-08-02
title: VA/DoD Clinical Practice Guideline for the Management of Substance Use Disorders
summary: High-quality government guideline for stabilization and withdrawal setting decisions; relevant to medical referral boundaries.
status: draft
quality: usable
aliases:
- source_artifact:va-dod-substance-use-disorder-guideline-2021-08-02
- va-dod-substance-use-disorder-guideline-2021-08-02
- candidate:withdrawal-safety-screening:004
categories:
- alcohol-abstinence
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
source:
  kind: guideline
  title: VA/DoD Clinical Practice Guideline for the Management of Substance Use Disorders
  authors: U.S. Department of Veterans Affairs; U.S. Department of Defense
  year: 2021
  journal: VA/DoD Clinical Practice Guideline
  citation: U.S. Department of Veterans Affairs; U.S. Department of Defense. VA/DoD Clinical Practice Guideline for the Management of Substance Use Disorders. VA/DoD Clinical Practice Guideline. 2021.
  url: https://www.healthquality.va.gov/guidelines/MH/sud
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 76c0a61ad1fa2df26042aa79b70abe46a2bdae4a32ca87a57f76e8fe8492376c
    url: https://www.healthquality.va.gov/guidelines/MH/sud
  canonicalUrl: https://www.healthquality.va.gov/guidelines/MH/sud
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline
  populationLabel: Adults receiving VA/DoD care with substance use disorders, including alcohol use disorder.
  durationLabel: Clinical stabilization and withdrawal-care pathway.
  aggregateRole: synthesis
  cohortKey: va-dod-substance-use-disorder-guideline-2021-08-02
  notes:
  - Guideline; no alcohol-free challenge effect estimate.
evidenceBucket: withdrawal risk and safety screening
whyItMatters: High-quality government guideline for stabilization and withdrawal setting decisions; relevant to medical referral boundaries.
potentialMurphEndpoints:
- withdrawal stabilization
- level-of-care setting
- complications
- clinician guidance boundary
protocolTakeaway: Use this source for withdrawal-risk screening and acute safety boundaries only; do not cite it as efficacy evidence for a 7-, 14-, or 30-day alcohol-free challenge.
murphTakeaway: Use to support clinician-guidance boundaries for users with dependence, severe symptoms, or complicated withdrawal history. Do not copy guideline PDFs into Git unless rights are separately verified.
studyDesign: Clinical guideline
modality: Alcohol withdrawal risk screening and safety guidance
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/va-dod-substance-use-disorder-guideline-2021-08-02
  sourceKey: source_artifact:va-dod-substance-use-disorder-guideline-2021-08-02
  extractedFromArtifactId: art_va-dod-substance-use-disorder-guideline-2021-08-02
  findingKind: safety
  population: Adults receiving VA/DoD care with substance use disorders, including alcohol use disorder.
  exposure: Evidence-based SUD assessment, stabilization, withdrawal management, and AUD treatment planning.
  outcome: withdrawal stabilization, level-of-care setting, complications, clinician guidance boundary
  summary: VA/DoD SUD guideline includes a Stabilization and Withdrawal module and is intended to support evidence-based care and improve outcomes, while not replacing clinical judgment.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: unknown
interventionOrExposure: Evidence-based SUD assessment, stabilization, withdrawal management, and AUD treatment planning.
comparatorOrControl: Not applicable.
durationOrFollowUp: Clinical stabilization and withdrawal-care pathway.
endpoints:
- withdrawal stabilization
- level-of-care setting
- complications
- clinician guidance boundary
effectEstimatesOrDirection: Guideline; no alcohol-free challenge effect estimate.
adverseEventsOrSafetyNotes: VA/DoD SUD guideline includes a Stabilization and Withdrawal module and is intended to support evidence-based care and improve outcomes, while not replacing clinical judgment.
limitations:
- Government clinical guideline for SUD care, not an abstinence challenge study.
- Rights status for local PDF redistribution was not confirmed.
populationMismatch: Patients in VA/DoD substance-use-disorder care pathways, not general wellness challengers.
directnessToProtocol: general_guideline
claimUseBoundary: Safety-only/context boundary. This source should not be promoted into direct protocol efficacy claims.
artifactCandidates:
- art_va-dod-substance-use-disorder-guideline-2021-08-02
---


This source is included for **Withdrawal-risk screening and acute safety guidance**.

**Findings:** VA/DoD SUD guideline includes a Stabilization and Withdrawal module and is intended to support evidence-based care and improve outcomes, while not replacing clinical judgment.

**Why it matters:** High-quality government guideline for stabilization and withdrawal setting decisions; relevant to medical referral boundaries.

**Potential experiment signals:** withdrawal stabilization, level-of-care setting, complications, clinician guidance boundary.

**Protocol takeaway:** Use as safety-screening or escalation evidence only. It does not support efficacy claims for 7-, 14-, or 30-day alcohol-free variants.

**Claim use:** `safety-only`.
