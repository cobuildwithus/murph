---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:chosen-primary-outcome-score
slug: biomarkers/chosen-primary-outcome-score
title: Chosen Primary Outcome Score
summary: A user-selected manual outcome score for one pre-declared HCP target, such as skin appearance, joint pain/function, tendon symptoms, recovery, or another configured target.
status: field-testing
quality: usable
aliases:
- primary outcome score
- target outcome score
- manual target score
- chosen endpoint score
categories:
- manual-metric
- self-experiment
- supplement
- collagen-supplementation
measurementContexts:
- manual_checkin
- standardized_photo_check
- validated_questionnaire_if_available
- weekly_review
unit: target-specific score
interpretationFrame:
  principle: The score is useful only when the same target, scale, timing, and context are used across baseline and intervention windows.
  caveat: Scores from different target domains are not comparable and should not be pooled without the configured outcome definition.
biomarker:
  shortName: Target score
  displayName: Chosen Primary Outcome Score
  unit: target-specific score
  valuePrecision: 1
  direction:
    desired: mixed_or_contextual
    label: Depends on the chosen target.
    nuance: Pain and GI scores usually aim lower; skin satisfaction or function scores may aim higher. The onboarding slot defines the expected direction.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 2
    aggregation: median
  explainerCards:

  -
    title: What it is
    body: A manually configured score for the single outcome the user chose before starting the run.
  -
    title: Why it matters
    body: HCP evidence is endpoint-specific, so one primary target is needed rather than a vague all-purpose collagen readout.
  -
    title: How to measure it
    body: Use the same scale, timing, lighting or activity context, and weekly review cadence throughout the run.
  measurement:
    bestContext: Use after a 14-day baseline and then weekly during the intervention, with the same scale and context each time.
    howToMeasure:
    - Define the target and direction before starting.
    - Use the same scale at baseline and follow-up.
    - Record confounders that could move the target independently of HCP.
    confounders:
    - product switch
    - training or rehab change
    - diet or protein change
    - skincare or sun exposure change
    - analgesic or rescue medication
    - illness or travel
    - new supplement or medication
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: cites
  target: source_artifact:pmid-39212129
-
  type: cites
  target: source_artifact:pmid-33742704
-
  type: cites
  target: source_artifact:pmid-30609761
-
  type: cites
  target: source_artifact:pmid-38590831
---

# Chosen Primary Outcome Score

This is a configurable manual endpoint for HCP runs. It exists because collagen-peptide evidence is target-specific: skin, joint, tendon, recovery, and bone contexts should not be collapsed into one generic collagen score.
