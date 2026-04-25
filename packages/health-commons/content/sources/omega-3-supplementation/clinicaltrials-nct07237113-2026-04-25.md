---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct07237113-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct07237113-2026-04-25
title: Muscle Recovery After Omega-3 Supplementation
summary: Current registry record for omega-3 supplementation, oxylipins, muscle damage, and recovery after eccentric exercise in young men; no results extracted.
status: draft
quality: usable
aliases:
- clinicaltrials-nct07237113-2026-04-25
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
sourceKind: trial_registry
directnessToProtocol: adjacent_variant
source:
  kind: web_page
  title: Muscle Recovery After Omega-3 Supplementation
  authors: ClinicalTrials.gov; Instituto de Ciencias de la Salud, Universidad de O'Higgins
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Muscle Recovery After Omega-3 Supplementation. NCT07237113.
  url: https://clinicaltrials.gov/study/NCT07237113
researchEvidence:
  designKind: other
  designLabel: Clinical trial registry record for omega-3 supplementation, muscle damage, and oxylipins
  populationLabel: Healthy young men, ages 18 to 40 years, in an eccentric-exercise muscle-damage study
  durationLabel: Eight weeks of omega-3 or placebo supplementation before eccentric-exercise testing in registry mirrors
  aggregateRole: primary
  cohortKey: clinicaltrials-nct07237113-omega-3-muscle-recovery
  participantCount: 30
  participantCountKind: approximate
  notes:
  - 'Participant count uses extraction note kind: target_enrollment_secondary_source.'
evidenceBucket: exercise_recovery_soreness
whyItMatters: It reinforces that active recovery research uses controlled eccentric-exercise challenges and mechanistic biomarkers.
potentialMurphEndpoints:
- muscle soreness
- strength loss
- CK
- fatty acid composition
- oxylipins
protocolTakeaway: Registry-only, adjacent/current evidence; do not use for efficacy claims until results are published and extracted.
murphTakeaway: Mechanistic endpoints like oxylipins are research-grade; users should not expect to track them casually.
studyDesign: Clinical trial registry record for omega-3 supplementation, muscle damage, and oxylipins
modality: Oral omega-3 supplementation versus placebo before eccentric exercise
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **exercise_recovery_soreness**.

**Findings:** The registry record describes a placebo-controlled study of omega-3 supplementation before eccentric exercise in young men, with endpoints including strength loss, plasma oxylipins, fatty acid composition, CK, soreness, and performance measures. No results were extracted, so it remains registry-only context.

**Why it matters:** It reinforces that active recovery research uses controlled eccentric-exercise challenges and mechanistic biomarkers.

**Potential experiment signals:** muscle soreness, strength loss, CK, fatty acid composition, oxylipins.

**Protocol takeaway:** Registry-only, adjacent/current evidence; do not use for efficacy claims until results are published and extracted.

**Claim use:** `context-only`.
