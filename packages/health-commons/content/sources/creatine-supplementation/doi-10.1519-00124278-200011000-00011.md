---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1519-00124278-200011000-00011
slug: sources/creatine-supplementation/doi-10.1519-00124278-200011000-00011
title: The effect of creatine supplementation on muscle strength and body composition during off-season training in female soccer players.
summary: In a small female soccer off-season trial, creatine supported strength gains but did not clearly enhance the lean-mass change beyond training.
status: draft
quality: usable
aliases:
  - The effect of creatine supplementation on muscle strength and body composition during off-season training in female soccer players.
  - doi:10.1519/00124278-200011000-00011
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
  title: The effect of creatine supplementation on muscle strength and body composition during off-season training in female soccer players.
  authors: Larson-Meyer DE, Hunter GR, Trowbridge CA, Turk JC, Ernest JM, Torman SL, Harbin PA
  year: 2000
  journal: Journal of Strength and Conditioning Research
  citation: Larson-Meyer DE, Hunter GR, Trowbridge CA, Turk JC, Ernest JM, Torman SL, Harbin PA (2000). The effect of creatine supplementation on muscle strength and body composition during off-season training in female soccer players.. Journal of Strength and Conditioning Research. doi:10.1519/00124278-200011000-00011.

  doi: 10.1519/00124278-200011000-00011
  url: https://doi.org/10.1519/00124278-200011000-00011
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized controlled trial
  participantCount: 14

  populationLabel: Female collegiate soccer players during off-season training
  durationLabel: 13 weeks; 1 week loading plus maintenance during off-season training
  aggregateRole: primary
  cohortKey: cohort:doi-10.1519-00124278-200011000-00011
protocolEvidence:
  -
    protocolKey: protocol_variant:creatine-supplementation/creatine-monohydrate
    groupId: repeated_sprint_power_trials
    stance: supports
    scope: direct_protocol
    result: mixed
    headline: Female soccer off-season trial found strength benefits with mixed body-composition results.
    implication: Can support strength/power-adjacent outcomes in trained female field-sport athletes.
    caveat: Do not present as a clear lean-mass effect in this batch.
    displayPriority: 70
evidenceBucket: repeated_sprint_power_trials
whyItMatters: Adds a female field-sport direct monohydrate trial to a male-heavy performance literature.
potentialMurphEndpoints:
  - bench press strength
  - full squat strength
  - fat- and bone-free lean mass
  - body composition
protocolTakeaway: Creatine may improve strength during training, while body-composition changes were not clearly enhanced.
murphTakeaway: Useful experiment signals include squat/press strength and body-weight or lean-mass changes.
studyDesign: rct
modality: off-season soccer resistance training
claimUse: supports-protocol
murphV1Priority: High
pdfRightsStatus: paywalled
---

This source is included for **repeated_sprint_power_trials**.

**Findings:** Creatine group had greater improvements in bench press and full squat strength; lean mass increased with training but was not enhanced by creatine in the accessible abstract.

**Population and intervention:** Female collegiate soccer players during off-season training; Creatine monohydrate in fluid-replacement beverage, reported as 7.5 g twice daily for 1 week then 5 g/day. Comparator: Placebo beverage during the same training period. Duration/follow-up: 13 weeks; 1 week loading plus maintenance during off-season training.

**Endpoints:** bench press strength, full squat strength, fat- and bone-free lean mass, body composition.

**Safety notes:** No adverse-event extraction was available from the accessible record for this batch. 

**Limitations:** Small sample. Field-sport off-season training study, not isolated repeated-sprint testing. Body-composition effect was not clearly positive.

**Population mismatch:** Female collegiate soccer players; results may not apply to untrained or non-athlete users.

**Why it matters:** Adds a female field-sport direct monohydrate trial to a male-heavy performance literature.

**Potential experiment signals:** bench press strength, full squat strength, fat- and bone-free lean mass, body composition.

**Protocol takeaway:** Creatine may improve strength during training, while body-composition changes were not clearly enhanced.

**Murph takeaway:** Useful experiment signals include squat/press strength and body-weight or lean-mass changes.

**Claim use:** `supports-protocol`. Directness: `direct_protocol`. Result boundary: `mixed`.
