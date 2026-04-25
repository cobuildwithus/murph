---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05932771-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct05932771-2026-04-25
title: Resistance Exercise and Hydrolyzed Collagen Supplementation
summary: ClinicalTrials.gov registry record for a crossover mechanistic hydrolyzed collagen dose-response study around resistance exercise.
status: draft
quality: usable
aliases:
- clinicaltrials-gov-nct05932771-2026-04-25
- Resistance Exercise and Hydrolyzed Collagen Supplementation
- NCT05932771
categories:
- collagen-supplementation
- exercise-performance-recovery
- same_mechanism
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
    registryId: NCT05932771
    url: https://clinicaltrials.gov/study/NCT05932771
  canonicalUrl: https://clinicaltrials.gov/study/NCT05932771
  identityAliases:
  - clinicaltrials-gov-nct05932771-2026-04-25
  - Resistance Exercise and Hydrolyzed Collagen Supplementation
  - NCT05932771
source:
  kind: web_page
  title: Resistance Exercise and Hydrolyzed Collagen Supplementation
  authors: ClinicalTrials.gov record; sponsor/investigators not extracted
  citation: ClinicalTrials.gov. Resistance Exercise and Hydrolyzed Collagen Supplementation. NCT05932771. Registry record accessed 2026-04-25.
  year: 2023
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT05932771
researchEvidence:
  designKind: crossover_trial
  designLabel: Trial registry record for crossover dose-response physiology study
  populationLabel: Healthy young and older males and females; full eligibility not extracted
  durationLabel: Acute resistance-exercise trials with washout; exact schedule not fully extracted
  cohortKey: clinicaltrials-gov-nct05932771-2026-04-25
  aggregateRole: primary
evidenceBucket: exercise-performance-recovery
whyItMatters: Mechanistic registry evidence for dose/timing context.
potentialMurphEndpoints:
- P1NP
- β-CTX
- whole-body collagen synthesis
- collagen amino acids
protocolTakeaway: Use as mechanism/dose context only until results are published and extracted.
murphTakeaway: Use as mechanism/dose context only until results are published and extracted. Preserve directness and comparator boundaries when synthesizing.
studyDesign: Trial registry record for crossover dose-response physiology study
modality: Hydrolyzed collagen plus vitamin C before resistance exercise
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: permission_required
ledgerClassification:
  evidenceBucket: exercise-performance-recovery
  directness: same_mechanism
  claimUse: context-only
  priority: medium
  batchId: batch-007
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: permission_required
---

This source is included for **exercise-performance-recovery**.

**Findings:** Registry context only; no outcome results extracted in this batch.

**Why it matters:** Mechanistic registry evidence for dose/timing context.

**Potential experiment signals:** P1NP, β-CTX, whole-body collagen synthesis, collagen amino acids.

**Protocol takeaway:** Use as mechanism/dose context only until results are published and extracted.

**Claim use:** `context-only`.

**Directness and boundary:** `same_mechanism`. Vitamin C co-administration and synthesis markers only.

**Safety notes:** Registry source; adverse events/results not extracted here.

**Limitations:** Mechanistic endpoints rather than clinical outcomes.; Registry-only source.; Vitamin C co-administration makes direct HCP-alone inference limited.

**Population mismatch:** Mechanistic dose-response trial; not patient-centered recovery or performance outcome evidence.

**Artifact notes:** No redistributable PDF stored; keep metadata/manifest candidate only unless rights are clearly open.
