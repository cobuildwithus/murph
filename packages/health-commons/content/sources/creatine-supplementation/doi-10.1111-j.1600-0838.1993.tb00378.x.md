---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1111-j.1600-0838.1993.tb00378.x
slug: sources/creatine-supplementation/doi-10.1111-j.1600-0838.1993.tb00378.x
title: Creatine supplementation and dynamic high-intensity intermittent exercise
summary: Foundational direct intermittent-exercise trial relevant to repeated sprint and power outcomes, but extracted public metadata did not provide sample size or numeric effects.
status: draft
quality: usable
aliases:
  - Creatine supplementation and dynamic high-intensity intermittent exercise
  - doi:10.1111/j.1600-0838.1993.tb00378.x
categories:
  - creatine-supplementation
relations:
  -
    type: related_protocol
    target: protocol_variant:creatine-supplementation/creatine-monohydrate
  -
    type: parent_family
    target: experiment_family:creatine-supplementation
source:
  kind: journal_article
  title: Creatine supplementation and dynamic high-intensity intermittent exercise
  authors: P. D. Balsom et al.
  year: 1993
  journal: Scandinavian Journal of Medicine & Science in Sports
  citation: P. D. Balsom et al. (1993). Creatine supplementation and dynamic high-intensity intermittent exercise. Scandinavian Journal of Medicine & Science in Sports. doi:10.1111/j.1600-0838.1993.tb00378.x.

  doi: 10.1111/j.1600-0838.1993.tb00378.x
  url: https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1600-0838.1993.tb00378.x
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Acute physiology/performance trial

  populationLabel: Healthy active men
  durationLabel: Short-term oral creatine loading; exact duration not extracted from accessible record
  aggregateRole: primary
  cohortKey: cohort:doi-10.1111-j.1600-0838.1993.tb00378.x
protocolEvidence:
  -
    protocolKey: protocol_variant:creatine-supplementation/creatine-monohydrate
    groupId: repeated_sprint_power_trials
    stance: supports
    scope: direct_protocol
    result: positive
    headline: Early intermittent high-intensity exercise source directly aligned to repeated-sprint claims.
    implication: Can support that creatine monohydrate was tested in repeated high-intensity exercise contexts.
    caveat: Do not use for numeric effect-size claims without full text.
    displayPriority: 70
evidenceBucket: repeated_sprint_power_trials
whyItMatters: This is an early direct protocol-performance source for repeated sprint/power outcomes.
potentialMurphEndpoints:
  - repeated-sprint/intermittent exercise performance
  - power output
  - fatigue during repeated efforts
protocolTakeaway: Direct but limited-access support for repeated high-intensity exercise testing.
murphTakeaway: Track repeated-effort performance and fatigue rather than only one maximal attempt.
studyDesign: acute_physiology
modality: repeated high-intensity intermittent exercise
claimUse: supports-protocol
murphV1Priority: High
pdfRightsStatus: paywalled
---

This source is included for **repeated_sprint_power_trials**.

**Findings:** Accessible metadata identifies this as a direct intermittent high-intensity exercise creatine study; exact effect estimates were not available in the extraction record.

**Population and intervention:** Healthy active men; Single-ingredient oral creatine supplementation before dynamic high-intensity intermittent exercise testing. Comparator: Placebo/control condition; exact comparator composition not extracted from accessible record. Duration/follow-up: Short-term oral creatine loading; exact duration not extracted from accessible record.

**Endpoints:** repeated-sprint/intermittent exercise performance, power output, fatigue during repeated efforts.

**Safety notes:** No adverse-event extraction was available from the accessible record for this batch. 

**Limitations:** Paywalled abstract/full text limited extraction of sample size and effect estimates. Older acute physiology design may not generalize to all sport settings.

**Population mismatch:** Healthy active men rather than mixed-sex community users.

**Why it matters:** This is an early direct protocol-performance source for repeated sprint/power outcomes.

**Potential experiment signals:** repeated-sprint/intermittent exercise performance, power output, fatigue during repeated efforts.

**Protocol takeaway:** Direct but limited-access support for repeated high-intensity exercise testing.

**Murph takeaway:** Track repeated-effort performance and fatigue rather than only one maximal attempt.

**Claim use:** `supports-protocol`. Directness: `direct_protocol`. Result boundary: `positive`.
