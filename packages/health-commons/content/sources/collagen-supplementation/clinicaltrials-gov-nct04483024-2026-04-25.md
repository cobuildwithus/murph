---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct04483024-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct04483024-2026-04-25
title: Chicken Extract and Collagen on Mobility
summary: Registry corresponds to the chicken essence/HC-II four-arm knee-OA pilot; collagen effect is not isolated.
status: draft
quality: usable
aliases:
- Chicken Extract and Collagen on Mobility
- clinicaltrials-gov-nct04483024-2026-04-25
- NCT04483024
categories:
- collagen-supplementation
- joint-osteoarthritis
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
    registryId: NCT04483024
    url: https://clinicaltrials.gov/study/NCT04483024
  canonicalUrl: https://clinicaltrials.gov/study/NCT04483024
  identityAliases:
  - Chicken Extract and Collagen on Mobility
  - clinicaltrials-gov-nct04483024-2026-04-25
  - NCT04483024
source:
  kind: web_page
  title: Chicken Extract and Collagen on Mobility
  authors: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Chicken Extract and Collagen on Mobility. NCT04483024. Accessed 2026-04-25.
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT04483024
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Trial registry record for randomized four-arm mobility study
  populationLabel: Adults with grade 1-3 knee osteoarthritis in linked publication
  durationLabel: 24 weeks in linked publication
  cohortKey: nct04483024-chicken-extract-collagen-mobility-registry
  participantCount: 160
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: joint-osteoarthritis
whyItMatters: Keeps registry-to-publication mapping intact and avoids counting it as a separate independent study.
potentialMurphEndpoints:
- mobility
- WOMAC
- VAS pain
- muscle function
- safety
protocolTakeaway: Context-only registry; link to PMID 36918892 rather than duplicate efficacy claims.
murphTakeaway: Registry records are useful for endpoints and design, but not separate evidence when a publication exists.
studyDesign: Trial registry record for randomized four-arm mobility study
modality: chicken essence and type-II collagen hydrolysate registry; adjacent product context
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: joint-osteoarthritis
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  batchId: batch-003
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **joint-osteoarthritis**.

**Findings:** NCT04483024 is the registry context for the four-arm chicken essence and hydrolyzed type-II collagen mobility study later published in Nutrition Journal. The linked study includes active comparator and placebo/context arms, with resistance training for all participants.

**Why it matters:** Keeps registry-to-publication mapping intact and avoids counting it as a separate independent study.

**Potential experiment signals:** mobility, WOMAC, VAS pain, muscle function, safety

**Protocol takeaway:** Context-only registry; link to PMID 36918892 rather than duplicate efficacy claims.

**Claim use:** `context-only`.
