---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct04578418-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct04578418-2026-04-25
title: Effect of Collagen Supplementation on Tendinopathy in Elite Athletes
summary: ClinicalTrials.gov registry for a hydrolyzed-collagen plus heavy-slow-resistance training tendinopathy trial in elite athletes.
status: draft
quality: usable
aliases:
- Effect of Collagen Supplementation on Tendinopathy in Elite Athletes
- NCT04578418
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
    registryId: NCT04578418
    url: https://clinicaltrials.gov/study/NCT04578418
  canonicalUrl: https://clinicaltrials.gov/study/NCT04578418
  identityAliases:
  - Effect of Collagen Supplementation on Tendinopathy in Elite Athletes
  - NCT04578418
source:
  kind: web_page
  title: Effect of Collagen Supplementation on Tendinopathy in Elite Athletes
  authors: ClinicalTrials.gov
  citation: 'ClinicalTrials.gov. NCT04578418: Effect of Collagen Supplementation on Tendinopathy in Elite Athletes. First posted 8 Oct 2020.'
  year: 2020
  journal: ClinicalTrials.gov trial registry
  url: https://clinicaltrials.gov/study/NCT04578418
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: Elite athletes with overload injury or tendinopathy.
  durationLabel: 12 weeks planned intervention
  cohortKey: clinicaltrials-gov-nct04578418-2026-04-25
  aggregateRole: context
evidenceBucket: tendon-loading-ligament
whyItMatters: It shows active testing of collagen as an add-on to standard tendon loading in elite athletes.
potentialMurphEndpoints:
- maximal tendon pain during sport
- tendon morphology ultrasound
- Doppler vascularization
- VISA-type function if collected
- SLDS/jump tests
protocolTakeaway: Registry-only source supports trial landscape and endpoint planning, not outcome claims.
murphTakeaway: Registry-only source supports trial landscape and endpoint planning, not outcome claims.
studyDesign: rct
modality: hydrolyzed_collagen_plus_heavy_slow_resistance_training_registry
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

**Population and intervention:** Elite athletes with tendinopathy/overload injury; detailed sample count was not extracted from the registry snippets. Intervention/exposure: Daily hydrolyzed collagen supplementation plus heavy-slow resistance training 3 times per week. Comparator/control: Daily placebo plus the same heavy-slow resistance training. Duration/follow-up: 12 weeks planned intervention.

**Endpoints:** Maximal tendon pain during preferred sporting activity, symptoms/function, tendon morphology by ultrasound, vascularization by Doppler, activity level, single-leg decline squat, jumping tests.

**Safety notes:** No adverse-event results extracted.

**Limitations:** Registry-only source.; No results available in extracted record.; Population and tendon sites may be heterogeneous.

**Population mismatch:** Direct tendinopathy/elite-athlete protocol but no efficacy results.

**Why it matters:** It shows active testing of collagen as an add-on to standard tendon loading in elite athletes.

**Potential experiment signals:** maximal tendon pain during sport; tendon morphology ultrasound; Doppler vascularization; VISA-type function if collected; SLDS/jump tests

**Protocol takeaway:** Registry-only source supports trial landscape and endpoint planning, not outcome claims.

**Claim use:** `context-only`. Directness: `direct_protocol`. Source key: `source_artifact:clinicaltrials-gov-nct04578418-2026-04-25`.
