---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cdc-alcohol-pregnancy-2026-04-02
slug: sources/alcohol-abstinence/cdc-alcohol-pregnancy-2026-04-02
title: About Alcohol Use During Pregnancy
summary: Current public-health pregnancy boundary guidance with clear no-safe-amount framing.
status: draft
quality: usable
aliases:
- source_artifact:cdc-alcohol-pregnancy-2026-04-02
- cdc-alcohol-pregnancy-2026-04-02
- candidate:medications-pregnancy-liver-mental-health:019
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
  kind: web_page
  title: About Alcohol Use During Pregnancy
  authors: Centers for Disease Control and Prevention
  year: 2026
  journal: CDC Alcohol and Pregnancy
  citation: Centers for Disease Control and Prevention. About Alcohol Use During Pregnancy. CDC Alcohol and Pregnancy. 2026
  url: https://www.cdc.gov/alcohol-pregnancy/about/index.html
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: b3086bd4d0aeb65f72393a8259e5cc0503573ca004e730c375a3595c2a95dad0
    url: https://www.cdc.gov/alcohol-pregnancy/about/index.html
  canonicalUrl: https://www.cdc.gov/alcohol-pregnancy/about/index.html
researchEvidence:
  designKind: other
  designLabel: Other / registry / case-report context
  populationLabel: Pregnant people or people trying to get pregnant
  durationLabel: Pregnancy-related guidance; not a 7-, 14-, or 30-day challenge duration study.
  aggregateRole: primary
  cohortKey: cdc-alcohol-pregnancy-2026-04-02
  notes:
  - Protocol-specific interpretation belongs to standalone evidence appraisal records, not source-page efficacy fields.
  - Directness and population mismatch are preserved for protocol synthesis.
evidenceBucket: medication, pregnancy, liver disease, and mental-health safety boundary
whyItMatters: Current public-health pregnancy boundary guidance with clear no-safe-amount framing.
potentialMurphEndpoints:
- safety
- pregnancy boundary
protocolTakeaway: Treat pregnancy, possible pregnancy, or trying to get pregnant as a strict pregnancy-care boundary; do not cite this as evidence for health benefits of a short alcohol-free challenge.
murphTakeaway: Treat pregnancy, possible pregnancy, or trying to get pregnant as a strict pregnancy-care boundary; do not cite this as evidence for health benefits of a short alcohol-free challenge.
studyDesign: Other / registry / case-report context
modality: Pregnancy alcohol-safety guidance
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/cdc-alcohol-pregnancy-2026-04-02
  sourceKey: source_artifact:cdc-alcohol-pregnancy-2026-04-02
  extractedFromArtifactId: art_cdc-alcohol-pregnancy-2026-04-02
  findingKind: safety
  population: Pregnant people or people trying to get pregnant
  exposure: Alcohol use during pregnancy and stopping alcohol use during pregnancy
  outcome: safety, pregnancy boundary
  summary: CDC pregnancy guidance frames alcohol use during pregnancy as a strict safety boundary; pregnancy or trying to get pregnant should route to pregnancy-specific guidance rather than wellness-challenge efficacy claims.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
interventionOrExposure: Alcohol use during pregnancy and stopping alcohol use during pregnancy
comparatorOrControl: Not applicable.
durationOrFollowUp: Pregnancy-related guidance; not a 7-, 14-, or 30-day challenge duration study.
endpoints:
- safety
- pregnancy boundary
effectEstimatesOrDirection: No challenge efficacy estimate. The public-health guidance states that there is no known safe amount, timing, or type of alcohol use during pregnancy.
adverseEventsOrSafetyNotes: Pregnancy or possible pregnancy should be treated as a hard safety boundary for user-facing alcohol advice.
limitations:
- Not a direct trial of self-guided 7-, 14-, or 30-day alcohol-free variants.
- Use is limited to safety, clinical context, measurement context, or adjacent-variant interpretation.
populationMismatch: Pregnant people or people trying to get pregnant differs from generally healthy community participants considering a short alcohol-free challenge.
directnessToProtocol: clinical_supervised
claimUseBoundary: Safety/context boundary. This source should not be promoted into direct protocol efficacy claims unless a future synthesis explicitly labels it as adjacent evidence.
artifactCandidates:
- art_cdc-alcohol-pregnancy-2026-04-02
---


This source is included for **Medication, pregnancy, liver disease, and mental-health safety boundaries (part 1)**.

**Findings:** CDC pregnancy guidance frames alcohol use during pregnancy as a strict safety boundary; pregnancy or trying to get pregnant should route to pregnancy-specific guidance rather than wellness-challenge efficacy claims.

**Why it matters:** Current public-health pregnancy boundary guidance with clear no-safe-amount framing.

**Potential experiment signals:** safety, pregnancy boundary.

**Protocol takeaway:** Treat pregnancy, possible pregnancy, or trying to get pregnant as a strict pregnancy-care boundary; do not cite this as evidence for health benefits of a short alcohol-free challenge.

**Claim use:** `safety-only`.
