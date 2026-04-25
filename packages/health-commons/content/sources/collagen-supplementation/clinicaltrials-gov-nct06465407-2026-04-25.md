---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06465407-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct06465407-2026-04-25
title: Collagen Protein Versus Placebo on Muscle Recovery
summary: ClinicalTrials.gov registry for collagen protein versus placebo on musculotendinous-unit recovery after eccentric plantar-flexor exercise.
status: draft
quality: usable
aliases:
- Collagen Protein Versus Placebo on Muscle Recovery
- NCT06465407
categories:
- collagen-supplementation
- tendon-loading-ligament
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
    registryId: NCT06465407
    url: https://clinicaltrials.gov/study/NCT06465407
  canonicalUrl: https://clinicaltrials.gov/study/NCT06465407
  identityAliases:
  - Collagen Protein Versus Placebo on Muscle Recovery
  - NCT06465407
source:
  kind: web_page
  title: Collagen Protein Versus Placebo on Muscle Recovery
  authors: ClinicalTrials.gov
  citation: 'ClinicalTrials.gov. NCT06465407: Collagen Protein Versus Placebo on Muscle Recovery. First posted 18 Jun 2024.'
  year: 2024
  journal: ClinicalTrials.gov trial registry
  url: https://clinicaltrials.gov/study/NCT06465407
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: Adults undergoing eccentric plantar-flexor exercise; exact count not extracted.
  durationLabel: Short-term recovery study with multiple visits over about 1-2 weeks
  cohortKey: clinicaltrials-gov-nct06465407-2026-04-25
  aggregateRole: context
evidenceBucket: tendon-loading-ligament
whyItMatters: It signals emerging interest in collagen for musculotendinous recovery, distinct from long-term tendon remodeling.
potentialMurphEndpoints:
- muscle soreness
- plantar-flexor function
- Achilles/calf recovery markers
- time-to-recovery
protocolTakeaway: Do not infer recovery efficacy until results are available.
murphTakeaway: Do not infer recovery efficacy until results are available.
studyDesign: rct
modality: collagen_protein_recovery_registry
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: tendon-loading-ligament
  directness: direct_protocol
  claimUse: context-only
  priority: medium
  batchId: batch-006
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **tendon-loading-ligament**.

**Findings:** Registry record only; no results extracted.

**Population and intervention:** Registry for collagen protein versus placebo after eccentric plantar-flexor exercise; exact count and eligibility details were not extracted. Intervention/exposure: Collagen protein supplementation around eccentric calf/plantar-flexor exercise. Comparator/control: Placebo supplementation around the same exercise challenge. Duration/follow-up: Short-term recovery study with multiple visits over about 1-2 weeks.

**Endpoints:** Indirect markers of musculotendinous-unit recovery, soreness, function, and calf/Achilles-related recovery markers.

**Safety notes:** No adverse-event results extracted.

**Limitations:** Registry-only source.; Recovery challenge rather than long-term tendon adaptation or tendinopathy treatment.; No results available.

**Population mismatch:** Direct collagen-protein recovery context, but not HCP-specific tendon-loading adaptation evidence yet.

**Why it matters:** It signals emerging interest in collagen for musculotendinous recovery, distinct from long-term tendon remodeling.

**Potential experiment signals:** muscle soreness; plantar-flexor function; Achilles/calf recovery markers; time-to-recovery

**Protocol takeaway:** Do not infer recovery efficacy until results are available.

**Claim use:** `context-only`. Directness: `direct_protocol`. Source key: `source_artifact:clinicaltrials-gov-nct06465407-2026-04-25`.
