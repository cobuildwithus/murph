---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:who-substance-use-pregnancy-2014-11-19
slug: sources/alcohol-abstinence/who-substance-use-pregnancy-2014-11-19
title: Guidelines for the identification and management of substance use and substance use disorders in pregnancy
summary: Global guideline for pregnancy as a boundary condition rather than a direct abstinence-challenge population.
status: draft
quality: usable
aliases:
- source_artifact:who-substance-use-pregnancy-2014-11-19
- who-substance-use-pregnancy-2014-11-19
- candidate:medications-pregnancy-liver-mental-health:017
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
  title: Guidelines for the identification and management of substance use and substance use disorders in pregnancy
  authors: World Health Organization
  year: 2014
  journal: World Health Organization
  citation: World Health Organization. Guidelines for the identification and management of substance use and substance use disorders in pregnancy. World Health Organization. 2014
  url: https://www.who.int/publications/i/item/9789241548731
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: e5815f54f3e0a12ee3acfd1535cadce65e7d7d2f04883452e46dc35527a1db81
    url: https://www.who.int/publications/i/item/9789241548731
  canonicalUrl: https://www.who.int/publications/i/item/9789241548731
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline / recommendation
  populationLabel: Pregnant people with substance use or substance use disorders
  durationLabel: Pregnancy clinical guideline; no challenge duration.
  aggregateRole: synthesis
  cohortKey: who-substance-use-pregnancy-2014-11-19
  notes:
  - Protocol-specific interpretation belongs to standalone evidence appraisal records, not source-page efficacy fields.
  - Directness and population mismatch are preserved for protocol synthesis.
evidenceBucket: medication, pregnancy, liver disease, and mental-health safety boundary
whyItMatters: Global guideline for pregnancy as a boundary condition rather than a direct abstinence-challenge population.
potentialMurphEndpoints:
- safety
- pregnancy boundary
- mental health boundary
protocolTakeaway: Use as global pregnancy boundary guidance only.
murphTakeaway: Use as global pregnancy boundary guidance only.
studyDesign: Clinical guideline / recommendation
modality: Pregnancy substance-use guideline
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/who-substance-use-pregnancy-2014-11-19
  sourceKey: source_artifact:who-substance-use-pregnancy-2014-11-19
  extractedFromArtifactId: art_who-substance-use-pregnancy-2014-11-19
  findingKind: safety
  population: Pregnant people with substance use or substance use disorders
  exposure: Identification, counseling, and management of substance use including alcohol during pregnancy
  outcome: safety, pregnancy boundary, mental health boundary
  summary: WHO pregnancy substance-use guidance supports pregnancy as a clinical-care and referral boundary for alcohol-related advice.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: permission_required
interventionOrExposure: Identification, counseling, and management of substance use including alcohol during pregnancy
comparatorOrControl: Not applicable.
durationOrFollowUp: Pregnancy clinical guideline; no challenge duration.
endpoints:
- safety
- pregnancy boundary
- mental health boundary
effectEstimatesOrDirection: No challenge efficacy estimate. WHO guideline addresses identification and management of substance use and substance use disorders in pregnancy.
adverseEventsOrSafetyNotes: Pregnancy and substance use disorder require pregnancy-specific clinical assessment and management.
limitations:
- Not a direct trial of self-guided 7-, 14-, or 30-day alcohol-free variants.
- Use is limited to safety, clinical context, measurement context, or adjacent-variant interpretation.
populationMismatch: Pregnant people with substance use or substance use disorders differs from generally healthy community participants considering a short alcohol-free challenge.
directnessToProtocol: general_guideline
claimUseBoundary: Safety/context boundary. This source should not be promoted into direct protocol efficacy claims unless a future synthesis explicitly labels it as adjacent evidence.
artifactCandidates:
- art_who-substance-use-pregnancy-2014-11-19
---


This source is included for **Medication, pregnancy, liver disease, and mental-health safety boundaries (part 1)**.

**Findings:** WHO pregnancy substance-use guidance supports pregnancy as a clinical-care and referral boundary for alcohol-related advice.

**Why it matters:** Global guideline for pregnancy as a boundary condition rather than a direct abstinence-challenge population.

**Potential experiment signals:** safety, pregnancy boundary, mental health boundary.

**Protocol takeaway:** Use as global pregnancy boundary guidance only.

**Claim use:** `safety-only`.
