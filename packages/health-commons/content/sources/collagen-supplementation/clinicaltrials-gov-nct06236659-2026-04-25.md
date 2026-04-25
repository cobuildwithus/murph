---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06236659-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct06236659-2026-04-25
title: Acute Resistance Exercise and Hydrolyzed Collagen Supplementation
summary: ClinicalTrials.gov registry record for an acute hydrolyzed collagen dose-response trial around resistance exercise in middle-aged adults.
status: draft
quality: usable
aliases:
- clinicaltrials-gov-nct06236659-2026-04-25
- Acute Resistance Exercise and Hydrolyzed Collagen Supplementation
- NCT06236659
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
    registryId: NCT06236659
    url: https://clinicaltrials.gov/study/NCT06236659
  canonicalUrl: https://clinicaltrials.gov/study/NCT06236659
  identityAliases:
  - clinicaltrials-gov-nct06236659-2026-04-25
  - Acute Resistance Exercise and Hydrolyzed Collagen Supplementation
  - NCT06236659
source:
  kind: web_page
  title: Acute Resistance Exercise and Hydrolyzed Collagen Supplementation
  authors: ClinicalTrials.gov record; sponsor Rob Erskine listed in indexed trial pages
  citation: ClinicalTrials.gov. Acute Resistance Exercise and Hydrolyzed Collagen Supplementation. NCT06236659. Registry record accessed 2026-04-25.
  year: 2024
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT06236659
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Trial registry record for acute collagen-synthesis dose-response study
  populationLabel: Healthy middle-aged males and females, 40–65 years, resistance-exercise experienced
  durationLabel: Acute 6-hour post-exercise trial with 7-day washout between dose trials
  cohortKey: clinicaltrials-gov-nct06236659-2026-04-25
  participantCount: 10
  participantCountKind: approximate
  aggregateRole: primary
evidenceBucket: exercise-performance-recovery
whyItMatters: Mechanistic registry hit for dose-response and timing.
potentialMurphEndpoints:
- P1NP
- β-CTX
- collagen amino acids
protocolTakeaway: Use as dose-response mechanism context, not protocol efficacy evidence.
murphTakeaway: Use as dose-response mechanism context, not protocol efficacy evidence. Preserve directness and comparator boundaries when synthesizing.
studyDesign: Trial registry record for acute collagen-synthesis dose-response study
modality: Hydrolyzed collagen plus vitamin C before leg-press exercise
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: exercise-performance-recovery
  directness: same_mechanism
  claimUse: context-only
  priority: medium
  batchId: batch-007
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **exercise-performance-recovery**.

**Findings:** Registry context only; no published results extracted from the registry record in this batch.

**Why it matters:** Mechanistic registry hit for dose-response and timing.

**Potential experiment signals:** P1NP, β-CTX, collagen amino acids.

**Protocol takeaway:** Use as dose-response mechanism context, not protocol efficacy evidence.

**Claim use:** `context-only`.

**Directness and boundary:** `same_mechanism`. No direct recovery/performance outcomes and no registry results extracted.

**Safety notes:** Registry source; adverse events/results not extracted here.

**Limitations:** Mechanistic collagen-turnover markers only.; Small enrollment.; Vitamin C co-administration.; Not direct patient-centered outcome evidence.

**Population mismatch:** Middle-aged resistance-trained mechanistic sample; not broad HCP efficacy evidence.

**Artifact notes:** No redistributable PDF stored; keep metadata/manifest candidate only unless rights are clearly open.
