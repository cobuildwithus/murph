---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05989815-2026-04-23
slug: sources/whole-body-photobiomodulation/clinicaltrials-gov-nct05989815-2026-04-23
title: Whole-body photobiomodulation for muscle performance enhancement, attenuation of muscular damage and delayed onset muscle soreness in professional soccer athletes
summary: Completed sham-controlled soccer registry and attached statistical report suggest timing-dependent CK and soreness benefits without muscle-performance improvement.
status: draft
quality: usable
aliases:
  - NCT05989815
  - clinicaltrials-gov-nct05989815-2026-04-23
categories:
  - whole-body-photobiomodulation
relations:

  -
    type: related_protocol
    target: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
  -
    type: parent_family
    target: experiment_family:whole-body-photobiomodulation
source:
  kind: web_page
  title: Whole-body photobiomodulation for muscle performance enhancement, attenuation of muscular damage and delayed onset muscle soreness in professional soccer athletes
  authors: Universidade Federal de São Carlos (sponsor)
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Whole-body photobiomodulation for muscle performance enhancement, attenuation of muscular damage and delayed onset muscle soreness in professional soccer athletes. Identifier NCT05989815.
  url: https://clinicaltrials.gov/study/NCT05989815
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Completed randomized double-blind sham-controlled parallel registry
  participantCount: 30
  participantCountKind: approximate
  populationLabel: Male professional soccer athletes aged 18-35 years training at least five times per week
  durationLabel: Acute pre/post-treatment around a muscle-damage protocol with follow-up through 72 hours
  aggregateRole: primary
  cohortKey: nct05989815-pro-soccer-doms
evidenceBucket: Exercise-timed whole-body PBM sibling variant
whyItMatters: This is an unusually detailed modern sham-controlled whole-body sports registry with direct timing comparisons and reported mixed results.
potentialMurphEndpoints:
  - creatine kinase
  - delayed-onset muscle soreness
  - squat jump
  - countermovement jump
  - manual dynamometry
protocolTakeaway: "Treat as adjacent-variant mixed evidence: pre-exercise PBM may blunt CK and soreness, post-exercise PBM may reduce soreness, but neither timing improved muscle performance."
murphTakeaway: Important implementation and outcome-boundary source, but do not treat registry-report findings as the same evidentiary tier as a full peer-reviewed paper.
studyDesign: Completed randomized double-blind sham-controlled parallel registry
modality: Whole-body red and near-infrared panel PBM applied before or after a muscle-damage protocol in professional soccer players
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **Exercise-timed whole-body PBM sibling variant**.

**Findings:** This completed ClinicalTrials.gov registry describes 30 male professional soccer athletes randomized to pre-exercise PBM, post-exercise PBM, or sham. The active intervention used a six-panel Joovv Elite system with red 660 nm and near-infrared 850 nm LEDs, about 20 cm from the body, for 10 minutes anterior and 10 minutes posterior. Registry materials and the attached statistical report indicate that pre-exercise PBM showed a protective CK signal and reduced delayed-onset muscle soreness at later time points, while post-exercise PBM reduced soreness but did not improve CK. Neither timing improved or worsened muscle-performance outcomes. This makes the registry a high-value mixed source rather than a positive one.

**Why it matters:** It is one of the clearest sham-controlled sports registries in the batch and directly compares pre- versus post-exercise whole-body timing.

**Potential experiment signals:** CK, DOMS, squat jump, countermovement jump, quadriceps strength, protocol timing.

**Protocol takeaway:** Keep as adjacent mixed evidence from registry materials, with explicit caution that no peer-reviewed outcome paper was linked in this batch.

**Claim use:** `context-only`.
