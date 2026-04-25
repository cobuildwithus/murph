---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct03999775-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct03999775-2026-04-25
title: Effect of Calcium and Vitamin D Supplementation With and Without Collagen Peptides in Postmenopausal Women With Osteopenia
summary: Registry confirms the calcium/D ± collagen peptide osteopenia program design and outcomes.
status: draft
quality: usable
aliases:
- Effect of Calcium and Vitamin D Supplementation With and Without Collagen Peptides in Postmenopausal Women With Osteopenia
- NCT03999775 calcium vitamin D collagen peptides osteopenia registry
- NCT03999775
categories:
- collagen-supplementation
- bone-density-turnover
- adjacent_variant
- context-only
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT03999775
    url: https://clinicaltrials.gov/study/NCT03999775
  canonicalUrl: https://clinicaltrials.gov/study/NCT03999775
  identityAliases:
  - Effect of Calcium and Vitamin D Supplementation With and Without Collagen Peptides in Postmenopausal Women With Osteopenia
  - NCT03999775 calcium vitamin D collagen peptides osteopenia registry
  - NCT03999775
source:
  kind: web_page
  title: Effect of Calcium and Vitamin D Supplementation With and Without Collagen Peptides in Postmenopausal Women With Osteopenia
  authors: ClinicalTrials.gov registry record; investigators not extracted
  citation: ClinicalTrials.gov. Effect of Calcium and Vitamin D Supplementation With and Without Collagen Peptides in Postmenopausal Women With Osteopenia. NCT03999775. Registry snapshot source key dated 2026-04-25.
  year: 2019
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT03999775
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Completed randomized parallel open-label registry record
  populationLabel: Female postmenopausal participants with osteopenia.
  durationLabel: Registry describes outcomes over up to 1 year in the osteopenia program.
  cohortKey: collagen-bone-batch-008-clinicaltrials-gov-nct03999775-2026-04-25
  participantCount: 51
  participantCountKind: approximate
  aggregateRole: context
evidenceBucket: bone-density-turnover
whyItMatters: It anchors the registry design behind the Greek osteopenia program.
potentialMurphEndpoints:
- randomization
- masking
- enrollment
- pre-specified endpoints
protocolTakeaway: Use for registration/design verification only.
murphTakeaway: Registry records help check whether outcomes were planned before results were published.
studyDesign: Completed randomized parallel open-label registry record
modality: trial registry for calcium/D ± collagen peptides
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
ledgerClassification:
  evidenceBucket: bone-density-turnover
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  batchId: batch-008
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: open_access
---

This source is included for **bone-density-turnover**.

**Findings:**

- **Population:** Female postmenopausal participants with osteopenia.
- **Intervention/exposure:** Calcium plus vitamin D plus bioactive collagen peptides.
- **Comparator/control:** Calcium plus vitamin D without collagen peptides.
- **Duration/follow-up:** Registry describes outcomes over up to 1 year in the osteopenia program.
- **Endpoints:** P1NP, CTX, BMD, tolerability.
- **Effect/direction:** Registry source provides design/outcome context rather than results; results should be taken from linked publications.
- **Adverse events/safety:** Registry lists tolerability/safety as an assessment context but no extracted adverse-event result.
- **Limitations:** Registry is design/pre-specification evidence, not a results source.; Open-label/no masking in accessible registry mirror.; Adjunct calcium/D intervention.
- **Population mismatch/directness:** Adjacent calcium/D co-intervention registry.

**Why it matters:** It anchors the registry design behind the Greek osteopenia program.

**Potential experiment signals:** randomization, masking, enrollment, pre-specified endpoints.

**Protocol takeaway:** Use for registration/design verification only.

**Claim use:** `context-only`.

**Artifact candidates and rights:** `open_access`. Do not place copyrighted PDFs in Git; preserve metadata/source-page draft unless rights are clearly open and redistributable.
