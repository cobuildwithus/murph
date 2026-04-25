---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct00536302-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct00536302-2026-04-25
title: A Placebo-Controlled Study of Collagen Hydrolysate in Subjects With Knee Osteoarthritis (OA)
summary: Registry for collagen hydrolysate knee-OA dGEMRIC pilot; useful for protocol matching, not standalone results.
status: draft
quality: usable
aliases:
- A Placebo-Controlled Study of Collagen Hydrolysate in Subjects With Knee Osteoarthritis (OA)
- clinicaltrials-gov-nct00536302-2026-04-25
- NCT00536302
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
    registryId: NCT00536302
    url: https://clinicaltrials.gov/study/NCT00536302
  canonicalUrl: https://clinicaltrials.gov/study/NCT00536302
  identityAliases:
  - A Placebo-Controlled Study of Collagen Hydrolysate in Subjects With Knee Osteoarthritis (OA)
  - clinicaltrials-gov-nct00536302-2026-04-25
  - NCT00536302
source:
  kind: web_page
  title: A Placebo-Controlled Study of Collagen Hydrolysate in Subjects With Knee Osteoarthritis (OA)
  authors: ClinicalTrials.gov
  citation: ClinicalTrials.gov. A Placebo-Controlled Study of Collagen Hydrolysate in Subjects With Knee Osteoarthritis (OA). NCT00536302. Accessed 2026-04-25.
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT00536302
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Trial registry record for randomized placebo-controlled knee-OA study
  populationLabel: Subjects with knee osteoarthritis
  durationLabel: 24 weeks in linked dGEMRIC pilot publication
  cohortKey: nct00536302-collagen-hydrolysate-knee-oa-registry
  participantCount: 30
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: joint-osteoarthritis
whyItMatters: Helps track direct HCP knee-OA trial registration and imaging endpoint details.
potentialMurphEndpoints:
- dGEMRIC MRI
- knee cartilage structure
- pain
- function
- adverse events
protocolTakeaway: Use as registry/protocol-detail context only.
murphTakeaway: Imaging endpoints are research-grade; symptom logs remain more feasible for a commons protocol.
studyDesign: Trial registry record for randomized placebo-controlled knee-OA study
modality: oral collagen hydrolysate versus placebo; registry context
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

**Findings:** The registry record describes a placebo-controlled collagen hydrolysate study in knee OA with MRI cartilage-structure endpoints. Search-accessible registry snippets reported 30 randomized participants. It is a direct-protocol registry source but not outcome evidence unless matched to the peer-reviewed dGEMRIC publication.

**Why it matters:** Helps track direct HCP knee-OA trial registration and imaging endpoint details.

**Potential experiment signals:** dGEMRIC MRI, knee cartilage structure, pain, function, adverse events

**Protocol takeaway:** Use as registry/protocol-detail context only.

**Claim use:** `context-only`.
