---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:skin-tolerability-symptoms"
slug: "biomarkers/skin-tolerability-symptoms"
title: "Skin and Eye Tolerability Symptoms"
summary: "A safety log for heat, pain, irritation, prolonged redness, blistering, pigment change, headache, eye discomfort, afterimages, blurry vision, flashes, or spots."
status: "draft"
quality: "usable"
aliases:
  - "LED mask tolerability"
  - "red light side effects"
  - "ocular symptoms during LED mask"
categories:
  - "skin"
  - "photoaging"
  - "self-assessment"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging"
  -
    type: "cites"
    target: "source_artifact:pmid-39122507"
  -
    type: "cites"
    target: "source_artifact:pmid-39335685"
  -
    type: "cites"
    target: "source_artifact:pmid-31483941"
  -
    type: "cites"
    target: "source_artifact:dermnet-drug-induced-photosensitivity-2026-04-24"
  -
    type: "cites"
    target: "source_artifact:aad-red-light-therapy-safety-2024-09-13"
measurementContexts:
  - "standardized_photo"
  - "self_rating"
unit: "symptom log"
interpretationFrame:
  principle: "Compare repeated baseline and intervention windows using the same camera, lighting, region, expression, and scoring rule."
  caveat: "This is a practical self-experiment proxy, not a dermatologist diagnosis or a validated clinical trial endpoint in the individual user."
biomarker:
  shortName: "Skin and Eye Tolerability Symptoms"
  displayName: "Skin and Eye Tolerability Symptoms"
  unit: "symptom log"
  valuePrecision: 0
  direction:
    desired: "lower_or_stable"
    label: "Lower or absent symptoms is preferred; any ocular symptom is a stop-and-review signal."
    nuance: "Absence of symptoms in a short self-test does not prove long-term safety or suitability for every device or skin type."
  trendDefaults:
    latestWindowDays: 42
    comparisonWindowDays: 14
    minimumPoints: 2
    aggregation: "median"
  explainerCards:

    -
      title: "What it is"
      body: "A safety log for heat, pain, irritation, prolonged redness, blistering, pigment change, headache, eye discomfort, afterimages, blurry vision, flashes, or spots."
    -
      title: "How to use it"
      body: "Use it as a before-and-after region score across a predefined baseline and intervention window, then review adherence and confounders before interpreting any change."
  measurement:
    bestContext: "Clinical adverse-event reporting is strongest; session-by-session symptom logging supports conservative stop rules."
    howToMeasure:
      - "Log heat, pain, redness, irritation, pigment change, headache, and ocular symptoms every session."
      - "Stop the session immediately for eye discomfort, afterimages, blurry vision, flashes, spots, burning, blistering, or painful irritation."
      - "Record eye-protection use and whether the device felt warm or uncomfortable."
    confounders:
      - "photosensitizing medications"
      - "ocular history"
      - "eye protection fit"
      - "device heat"
      - "skin type"
      - "melasma or PIH history"
      - "recent procedures"
      - "active irritation"
communityOutcomeSummary:
  state: "coming_soon"
  minimumCohortSize: 30
  placeholder: "Outcome summaries will appear only after enough opted-in runs use comparable photo workflow, adherence logs, and safety reporting."
---

Skin and eye tolerability is a secondary outcome and safety gate for this protocol. It should be reviewed before efficacy because an otherwise interesting photo signal is not worth continuing through visual symptoms, painful irritation, or pigment worsening.
