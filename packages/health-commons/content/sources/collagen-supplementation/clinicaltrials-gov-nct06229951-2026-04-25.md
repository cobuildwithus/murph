---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06229951-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct06229951-2026-04-25
title: Hydrolyzed Collagen and Undenatured Collagen Type II in Alleviating Pain in Patients With Knee OA
summary: Registry linked to combined hydrolyzed-collagen plus UC-II knee-OA trial that showed no placebo superiority in publication summaries.
status: draft
quality: usable
aliases:
- Hydrolyzed Collagen and Undenatured Collagen Type II in Alleviating Pain in Patients With Knee OA
- clinicaltrials-gov-nct06229951-2026-04-25
- NCT06229951
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
    registryId: NCT06229951
    url: https://clinicaltrials.gov/study/NCT06229951
  canonicalUrl: https://clinicaltrials.gov/study/NCT06229951
  identityAliases:
  - Hydrolyzed Collagen and Undenatured Collagen Type II in Alleviating Pain in Patients With Knee OA
  - clinicaltrials-gov-nct06229951-2026-04-25
  - NCT06229951
source:
  kind: web_page
  title: Hydrolyzed Collagen and Undenatured Collagen Type II in Alleviating Pain in Patients With Knee OA
  authors: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Hydrolyzed Collagen and Undenatured Collagen Type II in Alleviating Pain in Patients With Knee OA. NCT06229951. Accessed 2026-04-25.
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT06229951
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Trial registry record for randomized knee-OA trial
  populationLabel: Patients with knee osteoarthritis in linked publication
  durationLabel: 12 weeks in linked publication
  cohortKey: nct06229951-combined-collagen-knee-oa-registry
  participantCount: 68
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: joint-osteoarthritis
whyItMatters: Prevents duplicate counting and preserves the no-clear-advantage finding.
potentialMurphEndpoints:
- pain score
- KOOS
- rescue medication
- satisfaction
- adverse events
protocolTakeaway: Context-only registry linked to PMID 40897777.
murphTakeaway: Registry records help verify protocol design and product composition.
studyDesign: Trial registry record for randomized knee-OA trial
modality: hydrolyzed collagen plus undenatured collagen type II combination
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

**Findings:** NCT06229951 registers a knee-OA trial of hydrolyzed collagen plus undenatured type-II collagen. The linked publication (PMID 40897777) reported no significant between-group advantage versus placebo. This registry should serve as a boundary/protocol-detail source.

**Why it matters:** Prevents duplicate counting and preserves the no-clear-advantage finding.

**Potential experiment signals:** pain score, KOOS, rescue medication, satisfaction, adverse events

**Protocol takeaway:** Context-only registry linked to PMID 40897777.

**Claim use:** `context-only`.
