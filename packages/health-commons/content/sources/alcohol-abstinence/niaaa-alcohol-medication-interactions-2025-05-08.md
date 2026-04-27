---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:niaaa-alcohol-medication-interactions-2025-05-08
slug: sources/alcohol-abstinence/niaaa-alcohol-medication-interactions-2025-05-08
title: 'Alcohol-Medication Interactions: Potentially Dangerous Mixes'
summary: High-yield public health medication-interaction summary for patient-facing cautions before a short abstinence challenge.
status: draft
quality: usable
aliases:
- source_artifact:niaaa-alcohol-medication-interactions-2025-05-08
- niaaa-alcohol-medication-interactions-2025-05-08
- candidate:medications-pregnancy-liver-mental-health:001
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
  title: 'Alcohol-Medication Interactions: Potentially Dangerous Mixes'
  authors: National Institute on Alcohol Abuse and Alcoholism
  year: 2025
  journal: NIAAA Core Resource on Alcohol
  citation: 'National Institute on Alcohol Abuse and Alcoholism. Alcohol-Medication Interactions: Potentially Dangerous Mixes. NIAAA Core Resource on Alcohol. 2025'
  url: https://www.niaaa.nih.gov/health-professionals-communities/core-resource-on-alcohol/alcohol-medication-interactions-potentially-dangerous-mixes
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: ff5927c064b75fd0f379795386b6a11903674af8d5fa68a71911bac8757c9ec9
    url: https://www.niaaa.nih.gov/health-professionals-communities/core-resource-on-alcohol/alcohol-medication-interactions-potentially-dangerous-mixes
  canonicalUrl: https://www.niaaa.nih.gov/health-professionals-communities/core-resource-on-alcohol/alcohol-medication-interactions-potentially-dangerous-mixes
researchEvidence:
  designKind: other
  designLabel: Other / registry / case-report context
  populationLabel: Adults using prescription or over-the-counter medications; includes older adults and people prescribed sedatives or opioids
  durationLabel: Professional resource; no challenge duration.
  aggregateRole: primary
  cohortKey: niaaa-alcohol-medication-interactions-2025-05-08
  notes:
  - Protocol-specific interpretation belongs to standalone evidence appraisal records, not source-page efficacy fields.
  - Directness and population mismatch are preserved for protocol synthesis.
evidenceBucket: medication, pregnancy, liver disease, and mental-health safety boundary
whyItMatters: High-yield public health medication-interaction summary for patient-facing cautions before a short abstinence challenge.
potentialMurphEndpoints:
- safety
- medication interaction
protocolTakeaway: Use for broad medication-interaction screening and education, not as evidence that abstinence challenge variants improve outcomes.
murphTakeaway: Use for broad medication-interaction screening and education, not as evidence that abstinence challenge variants improve outcomes.
studyDesign: Other / registry / case-report context
modality: Alcohol-medication interaction guidance
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/niaaa-alcohol-medication-interactions-2025-05-08
  sourceKey: source_artifact:niaaa-alcohol-medication-interactions-2025-05-08
  extractedFromArtifactId: art_niaaa-alcohol-medication-interactions-2025-05-08
  findingKind: safety
  population: Adults using prescription or over-the-counter medications; includes older adults and people prescribed sedatives or opioids
  exposure: Alcohol use with alcohol-interactive medications, especially sedatives, benzodiazepines, opioids, antidepressants, NSAIDs, and acetaminophen
  outcome: safety, medication interaction
  summary: NIAAA summarizes potentially dangerous alcohol-medication interactions across prescription and over-the-counter medicines, including sedatives, opioids, antidepressants, NSAIDs, and acetaminophen.
  evidenceUse:
  - safety
  - context
murphV1Priority: High
pdfRightsStatus: open_access
interventionOrExposure: Alcohol use with alcohol-interactive medications, especially sedatives, benzodiazepines, opioids, antidepressants, NSAIDs, and acetaminophen
comparatorOrControl: Not applicable.
durationOrFollowUp: Professional resource; no challenge duration.
endpoints:
- safety
- medication interaction
effectEstimatesOrDirection: No challenge efficacy estimate. The resource summarizes clinically important alcohol-medication interactions and population-level exposure context.
adverseEventsOrSafetyNotes: Medication review is a pre-challenge safety requirement, especially for sedatives, opioids, antidepressants, NSAIDs, acetaminophen, and older-adult medication lists.
limitations:
- Not a direct trial of self-guided 7-, 14-, or 30-day alcohol-free variants.
- Use is limited to safety, clinical context, measurement context, or adjacent-variant interpretation.
populationMismatch: Adults using prescription or over-the-counter medications; includes older adults and people prescribed sedatives or opioids differs from generally healthy community participants considering a short alcohol-free challenge.
directnessToProtocol: general_guideline
claimUseBoundary: Safety/context boundary. This source should not be promoted into direct protocol efficacy claims unless a future synthesis explicitly labels it as adjacent evidence.
artifactCandidates:
- art_niaaa-alcohol-medication-interactions-2025-05-08
---


This source is included for **Medication, pregnancy, liver disease, and mental-health safety boundaries (part 1)**.

**Findings:** NIAAA summarizes potentially dangerous alcohol-medication interactions across prescription and over-the-counter medicines, including sedatives, opioids, antidepressants, NSAIDs, and acetaminophen.

**Why it matters:** High-yield public health medication-interaction summary for patient-facing cautions before a short abstinence challenge.

**Potential experiment signals:** safety, medication interaction.

**Protocol takeaway:** Use for broad medication-interaction screening and education, not as evidence that abstinence challenge variants improve outcomes.

**Claim use:** `safety-only`.
