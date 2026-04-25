---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct04796532-2021-03-16
slug: sources/tabata-interval-training/clinicaltrials-nct04796532-2021-03-16
title: Home Based or Traditional Class HIIT in Overweight Women
summary: ClinicalTrials.gov registry record for a pragmatic randomized HIIT study in overweight women using a Tabata-method 20/10 structure in home-based or traditional class delivery; included for implementation context only unless a results publication is extracted separately.
status: draft
quality: usable
aliases:
  - NCT04796532
  - Home-based or class Tabata-method HIIT
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
    url: https://clinicaltrials.gov/study/NCT04796532
  canonicalUrl: https://clinicaltrials.gov/study/NCT04796532
sourceKind: trial_registry
source:
  kind: other
  title: Home Based or Traditional Class HIIT in Overweight Women
  authors: ClinicalTrials.gov record
  year: 2021
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT04796532
  citation: ClinicalTrials.gov. Home Based or Traditional Class HIIT in Overweight Women. NCT04796532. First posted March 16, 2021. Accessed April 24, 2026. https://clinicaltrials.gov/study/NCT04796532.
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Trial registry record for three-arm pragmatic HIIT implementation
  participantCount: 90
  participantCountKind: approximate
  populationLabel: Overweight women
  durationLabel: 16-week HIIT implementation program
  cohortKey: clinicaltrials-nct04796532-2021-03-16
  aggregateRole: context
  notes:
    - Enrollment count is an estimated registry value, not an extracted analysis sample.
protocolEvidence:
  -
    protocolKey: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
    groupId: clinicaltrials-nct04796532-2021-03-16
    stance: context_only
    scope: adjacent_variant
    result: not_efficacy_evidence
    endpointKeys:
      - biomarker:estimated-vo2max
    headline: Registry describes Tabata-method HIIT in overweight women but does not provide extractable outcome evidence in this batch.
    implication: Useful for implementation questions such as home versus class delivery and adherence context.
    caveat: Registry-only source; do not use for outcomes unless a publication or posted results record is separately extracted.
    displayPriority: 60
evidenceBucket: trial_registry_context
whyItMatters: It links a practical 20/10-style implementation to body composition, physical activity, and cardiorespiratory-fitness endpoints without providing results in this batch.
potentialMurphEndpoints:
  - adherence
  - physical activity
  - body composition
  - cardiorespiratory fitness
  - home versus class delivery
protocolTakeaway: Treat as adjacent implementation evidence because population, delivery, and trial status differ from direct single-block Tabata evidence.
murphTakeaway: Use as registry context for practical Tabata delivery, not efficacy claims.
studyDesign: ClinicalTrials.gov registry record for randomized interventional study.
modality: Home-based and class-based Tabata-method HIIT
directness: adjacent_variant
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
sourceExtractionBatch: 12-source-extraction-009
---
This source is included for **trial_registry_context**.

**Findings:**
- The registry describes overweight women in home-based or traditional class HIIT programs using a Tabata-method structure of 20-second exercise bouts separated by 10-second rests.
- Endpoints are implementation- and cardiometabolic-adjacent, but this extraction does not include posted outcomes or adverse-event results.

**Why it matters:** It links a practical 20/10-style implementation to body composition, physical activity, and cardiorespiratory-fitness endpoints without providing results in this batch.

**Potential experiment signals:** adherence, physical activity, body composition, cardiorespiratory fitness, home versus class delivery.

**Protocol takeaway:** Treat as adjacent implementation evidence because population, delivery, and trial status differ from direct single-block Tabata evidence.

**Limitations and boundaries:**
- Estimated enrollment is not a completed analysis sample.
- Registry-only extraction; results should be linked to publications or posted results before synthesis.
- Population is overweight women, which may not generalize to all Tabata 20/10 users.

**Claim use:** `context-only`.
