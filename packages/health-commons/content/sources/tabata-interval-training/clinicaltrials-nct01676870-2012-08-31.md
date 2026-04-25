---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01676870-2012-08-31
slug: sources/tabata-interval-training/clinicaltrials-nct01676870-2012-08-31
title: Exercise in Prevention of Metabolic Syndrome (EX-MET)
summary: ClinicalTrials.gov registry anchor for EX-MET, a randomized exercise trial in adults with metabolic syndrome comparing longer aerobic interval-training doses and moderate continuous training; included as adjacent HIIT registry context, not Tabata 20/10 evidence.
status: draft
quality: usable
aliases:
  - NCT01676870
  - EX-MET
categories:
  - tabata-interval-training
relations:
  -
    type: related_protocol
    target: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
  -
    type: parent_family
    target: experiment_family:tabata-interval-training
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    url: https://clinicaltrials.gov/study/NCT01676870
  canonicalUrl: https://clinicaltrials.gov/study/NCT01676870
sourceKind: trial_registry
source:
  kind: other
  title: Exercise in Prevention of Metabolic Syndrome (EX-MET)
  authors: ClinicalTrials.gov
  year: 2012
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT01676870
  citation: ClinicalTrials.gov. Exercise in Prevention of Metabolic Syndrome (EX-MET). NCT01676870. First posted/registered 2012. Accessed April 24, 2026. https://clinicaltrials.gov/study/NCT01676870.
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Trial registry record for multi-arm exercise intervention
  participantCount: 465
  participantCountKind: approximate
  populationLabel: Adults with metabolic syndrome
  durationLabel: 16-week supervised phase with longer follow-up planned to 1 and 3 years
  cohortKey: clinicaltrials-nct01676870-2012-08-31
  aggregateRole: context
  notes:
    - Participant count is target/registry context, not an extracted completed-analysis denominator.
protocolEvidence:
  -
    protocolKey: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
    groupId: clinicaltrials-nct01676870-2012-08-31
    stance: context_only
    scope: adjacent_variant
    result: not_efficacy_evidence
    endpointKeys: []
    headline: Registry context for longer aerobic interval-training variants, not 20/10 Tabata.
    implication: Useful for separating 4×4-minute and 1×4-minute interval protocols from Tabata 20/10 claims.
    caveat: Registry record only in this batch; outcomes and adverse events must be extracted from corresponding publications before use.
    displayPriority: 70
evidenceBucket: trial_registry_context
whyItMatters: It is a provenance source for adjacent HIIT volume comparisons and time-burden boundaries in metabolic syndrome.
potentialMurphEndpoints:
  - cardiometabolic risk factors
  - exercise time burden
  - adherence
  - longer-term follow-up
protocolTakeaway: Do not import EX-MET interval-training results into Tabata 20/10; use the registry only to tag adjacent HIIT designs.
murphTakeaway: Use as adjacent clinical-supervised HIIT context and publication-provenance anchor.
studyDesign: Trial registry record for randomized multi-arm exercise intervention.
modality: Aerobic interval training and moderate continuous exercise
directness: adjacent_variant
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
sourceExtractionBatch: 12-source-extraction-009
---
This source is included for **trial_registry_context**.

**Findings:**
- The registry describes adults with metabolic syndrome assigned to aerobic interval-training variants and moderate continuous training, with cardiometabolic risk-factor endpoints.
- The interval doses are longer aerobic interval formats, such as 4-minute interval structures, rather than 20/10 Tabata.

**Why it matters:** It is a provenance source for adjacent HIIT volume comparisons and time-burden boundaries in metabolic syndrome.

**Potential experiment signals:** cardiometabolic risk factors, exercise time burden, adherence, longer-term follow-up.

**Protocol takeaway:** Do not import EX-MET interval-training results into Tabata 20/10; use the registry only to tag adjacent HIIT designs.

**Limitations and boundaries:**
- Registry record is not a peer-reviewed results report.
- The target sample size is not an analyzed outcome denominator.
- Outcomes and adverse events should be extracted from linked publications, not inferred from registry design.

**Claim use:** `context-only`.
