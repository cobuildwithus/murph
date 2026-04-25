---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05149053-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct05149053-2026-04-25
title: Hydrolyzed Collagen in the Reduction of Pain and Improvement of Physical Function
summary: Registry for oral hydrolyzed collagen in pain/function outcomes; publication matching is needed before claim use.
status: draft
quality: usable
aliases:
- Hydrolyzed Collagen in the Reduction of Pain and Improvement of Physical Function
- clinicaltrials-gov-nct05149053-2026-04-25
- NCT05149053
categories:
- collagen-supplementation
- joint-osteoarthritis
- direct_protocol
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
    registryId: NCT05149053
    url: https://clinicaltrials.gov/study/NCT05149053
  canonicalUrl: https://clinicaltrials.gov/study/NCT05149053
  identityAliases:
  - Hydrolyzed Collagen in the Reduction of Pain and Improvement of Physical Function
  - clinicaltrials-gov-nct05149053-2026-04-25
  - NCT05149053
source:
  kind: web_page
  title: Hydrolyzed Collagen in the Reduction of Pain and Improvement of Physical Function
  authors: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Hydrolyzed Collagen in the Reduction of Pain and Improvement of Physical Function. NCT05149053. Accessed 2026-04-25.
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT05149053
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Trial registry record for randomized placebo-controlled hydrolyzed-collagen study
  populationLabel: People with osteoarticular pain or functional limitation / knee osteoarthritis in registry-publication context
  durationLabel: Not extracted from registry source in this batch
  cohortKey: nct05149053-hydrolyzed-collagen-pain-function-registry
  aggregateRole: primary
evidenceBucket: joint-osteoarthritis
whyItMatters: Direct registry candidate that should be reconciled against publications before synthesis.
potentialMurphEndpoints:
- pain
- physical function
- CRP
- ESR
- patient satisfaction
- treatment-emergent adverse effects
protocolTakeaway: Context-only registry; do not cite as result evidence until matched.
murphTakeaway: 'Registry endpoints can shape what to monitor: pain/function plus safety and inflammation where feasible.'
studyDesign: Trial registry record for randomized placebo-controlled hydrolyzed-collagen study
modality: oral hydrolyzed collagen; direct-protocol registry context
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: joint-osteoarthritis
  directness: direct_protocol
  claimUse: context-only
  priority: medium
  batchId: batch-003
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **joint-osteoarthritis**.

**Findings:** NCT05149053 describes hydrolyzed collagen for reducing pain and improving physical function, with endpoints including osteoarticular pain, functional limitation, inflammatory markers, satisfaction, and adverse effects. A possible knee-OA publication match exists, but this registry extraction did not recover enough detail to make outcome claims.

**Why it matters:** Direct registry candidate that should be reconciled against publications before synthesis.

**Potential experiment signals:** pain, physical function, CRP, ESR, patient satisfaction, treatment-emergent adverse effects

**Protocol takeaway:** Context-only registry; do not cite as result evidence until matched.

**Claim use:** `context-only`.
