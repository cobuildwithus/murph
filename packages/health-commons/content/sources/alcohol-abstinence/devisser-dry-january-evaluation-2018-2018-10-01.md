---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:devisser-dry-january-evaluation-2018-2018-10-01
slug: sources/alcohol-abstinence/devisser-dry-january-evaluation-2018-2018-10-01
title: Evaluation of Dry January 2018
summary: Grey-literature evaluation report for the official Dry January 2018 campaign; retained as campaign implementation context, not as a standalone causal estimate.
status: draft
quality: usable
aliases:
- Evaluation of Dry January 2018
- Richard O. de Visser 2018
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
  kind: other
  title: Evaluation of Dry January 2018
  authors: Richard O. de Visser
  year: 2018
  journal: University of Sussex / Alcohol Change UK evaluation report
  citation: Richard O. de Visser. Evaluation of Dry January 2018. University of Sussex / Alcohol Change UK evaluation report 2018.
  url: https://www.hitchmarketing.co.uk/wp-content/uploads/2024/03/R-de-Visser-Dry-January-evaluation-2018.pdf
sourceIdentity:
  identityKind: other
  canonicalIdBasis: url
  identifiers:
    titleHash: ecdeec3e5ca8f853750e0914ba2e5cd950cb15c7cc51b0c0450859d7595c3a6e
    url: https://www.hitchmarketing.co.uk/wp-content/uploads/2024/03/R-de-Visser-Dry-January-evaluation-2018.pdf
  canonicalUrl: https://www.hitchmarketing.co.uk/wp-content/uploads/2024/03/R-de-Visser-Dry-January-evaluation-2018.pdf
  identityAliases:
  - Evaluation of Dry January 2018
  - Richard O. de Visser 2018
researchEvidence:
  designKind: prospective_cohort
  designLabel: Grey-literature Dry January participant evaluation
  populationLabel: Dry January 2018 registrants and survey respondents; analytic counts not verified in this extraction
  durationLabel: January 2018 challenge with post-challenge survey follow-up
  aggregateRole: primary
  cohortKey: devisser-2018-dry-january-evaluation
  notes:
  - source-index.json was absent in the supplied snapshot; identity resolution used the canonical source ledger and fallback content inventory.
  - Unknown or non-person corpus counts were not entered as participantCount to preserve Health Commons contract validity.
evidenceBucket: Dry January and temporary abstinence campaign evidence
whyItMatters: Captures official-campaign context and potential implementation signals, while the extraction did not verify granular analytic denominators or effect estimates.
potentialMurphEndpoints:
- campaign registration and support use
- self-reported abstinence completion
- post-challenge drinking intentions
protocolTakeaway: Use as implementation context for a 30-day challenge; cite peer-reviewed Dry January analyses for outcome claims.
murphTakeaway: Use as implementation context for a 30-day challenge; cite peer-reviewed Dry January analyses for outcome claims.
studyDesign: Prospective campaign evaluation report
modality: Official Dry January campaign evaluation
claimUse: context-only
directness: adjacent_variant
participantCountNote: Participant count not extracted or not applicable.
endpoints:
- campaign registration and support use
- self-reported abstinence completion
- post-challenge drinking intentions
effectEstimatesOrDirection: The 2018 evaluation report is a grey-literature source for official Dry January implementation and self-reported participant outcomes; analytic denominators and effects were not independently verified in this batch.
adverseEventsOrSafetyNotes: No adverse-event data extracted.
limitations: Grey literature; exact analytic sample sizes and effect estimates were not verified in this batch.
populationMismatch: Directly about Dry January but not a 7-day or 14-day variant; self-selected campaign participants.
claimUseBoundary: Do not use for causal efficacy claims unless specific estimates are later extracted and cross-checked.
sourceFindings:
-
  findingId: finding:alcohol-abstinence/batch-002/devisser-dry-january-evaluation-2018-2018-10-01/campaign-evaluation-context
  sourceKey: source_artifact:devisser-dry-january-evaluation-2018-2018-10-01
  extractedFromArtifactId: art_devisser-dry-january-evaluation-2018-2018-10-01_pdf
  findingKind: context
  population: Dry January 2018 official campaign participants/respondents
  exposure: Participation in the official Dry January campaign
  outcome: Campaign implementation and self-reported outcomes
  summary: The 2018 evaluation report is a grey-literature source for official Dry January implementation and self-reported participant outcomes; analytic denominators and effects were not independently verified in this batch.
  evidenceUse:
  - context
murphV1Priority: High
pdfRightsStatus: unknown
---


This source is included for **Dry January and temporary abstinence campaign evidence**.

**Findings:**
- The 2018 evaluation report is a grey-literature source for official Dry January implementation and self-reported participant outcomes; analytic denominators and effects were not independently verified in this batch.

**Why it matters:** Captures official-campaign context and potential implementation signals, while the extraction did not verify granular analytic denominators or effect estimates.

**Potential experiment signals:**
- campaign registration and support use
- self-reported abstinence completion
- post-challenge drinking intentions

**Protocol takeaway:** Use as implementation context for a 30-day challenge; cite peer-reviewed Dry January analyses for outcome claims.

**Claim use:** `context-only`.
