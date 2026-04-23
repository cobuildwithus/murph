---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:blood-oxygen-spo2
slug: biomarkers/blood-oxygen-spo2
title: "Blood Oxygen Saturation (SpO₂)"
summary: "A respiratory and sleep-context signal that estimates the percentage of oxygen-saturated hemoglobin in blood; useful for spotting personal baseline shifts, repeated overnight desaturation patterns, altitude or illness context, and symptom-matched safety signals."
status: field-testing
quality: usable
aliases:
  - SpO2
  - SpO₂
  - blood oxygen
  - blood oxygen level
  - blood oxygen saturation
  - oxygen saturation
  - pulse ox
  - pulse oximetry
categories:
  - respiratory
  - cardiovascular
  - sleep
  - wearable-metric
  - safety-signal
measurementContexts:
  - overnight_wearable
  - finger_pulse_oximeter
  - clinical_pulse_oximeter
  - high_altitude_context
  - symptom_context
unit: "%"
interpretationFrame:
  principle: "Stable personal-normal readings matter more than chasing a higher number; repeated drops or symptom-matched lows are safety signals, not optimization targets."
  caveat: "SpO₂ is vulnerable to device class, skin pigmentation, perfusion, temperature, movement, nail polish, tobacco or carbon-monoxide exposure, altitude, illness, and sleep-disordered breathing. Compare same-device same-context trends and treat low or symptom-matched readings as medical context."
biomarker:
  shortName: "SpO₂"
  displayName: "Blood Oxygen Saturation (SpO₂)"
  unit: "%"
  valuePrecision: 1
  direction:
    desired: stable
    label: "Stable in your normal range is usually the goal."
    nuance: "For many healthy sea-level adults, SpO₂ already sits near a physiological ceiling. Higher is not an experiment target; repeated lows, drops from baseline, or lows paired with shortness of breath, chest pain, confusion, bluish lips or nails, or unusual fatigue deserve medical context."
  privateMetricBindings:
    -
      source: browser_vault_metric
      domain: sleep
      metric: spo2
      unit: "%"
      preferred: true
    -
      source: browser_vault_metric
      domain: recovery
      metric: spo2
      unit: "%"
    -
      source: browser_vault_signal_summary
      accessor: sleep.spo2
      unit: "%"
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 30
    minimumPoints: 5
    aggregation: median
  explainerCards:
    -
      title: "What it is"
      body: "SpO₂ is a pulse-oximetry estimate of the percentage of hemoglobin carrying oxygen. Murph treats it as a respiratory, sleep, altitude, illness, and safety-context signal rather than a performance score."
    -
      title: "Why people care"
      body: "SpO₂ can help contextualize sleep-disordered breathing patterns, respiratory illness, altitude exposure, recovery strain, and symptom-matched low-oxygen warnings. It is most useful when compared with your own same-device baseline."
    -
      title: "How to read it"
      body: "Use overnight wearable trends for repeated personal context and a medical-grade finger pulse oximeter for careful symptom-driven spot checks. Prefer medians and repeated patterns over one noisy reading."
    -
      title: "What can fool it"
      body: "Cold hands, poor circulation, movement, sensor fit, nail polish or artificial nails, tobacco or carbon monoxide exposure, skin pigmentation, altitude, illness, and general-wellness device limits can all distort readings."
  measurement:
    bestContext: "For self-tracking, overnight wearable SpO₂ is best for repeated personal trend and desaturation context; a medical-grade finger pulse oximeter is better for symptom-driven spot checks; arterial blood gas or clinical co-oximetry remains more definitive in clinical care."
    howToMeasure:
      - "Compare like with like: same device, same sensor placement, same time window, and the same daytime-versus-overnight context."
      - "For a finger pulse oximeter, use a warm relaxed hand, remove nail polish or artificial nails when practical, sit still, keep the hand below heart level if instructed, and wait until the number is steady before recording it."
      - "Record date, time, symptoms, altitude or travel, respiratory illness, fever, asthma or COPD flare, unusual fatigue, chest discomfort, shortness of breath, supplemental oxygen use, and device changes."
      - "For overnight wearable data, separate the nightly median or average from desaturation events; a stable median can hide repeated dips, and a single dip can be movement artifact."
      - "Do not use consumer wearable SpO₂ alone to diagnose sleep apnea, pneumonia, COPD exacerbation, heart disease, or any other condition. Use it to decide whether a symptom pattern or repeated trend deserves clinical follow-up."
      - "Treat low readings that match concerning symptoms as safety context even if the wearable is imperfect; clinician-specific thresholds and emergency instructions override generic wellness ranges."
      - "Do not try to optimize SpO₂ upward if it is already in your normal range. The practical goal is stable normal oxygenation and absence of repeated unexplained drops."
    confounders:
      - device class
      - skin pigmentation
      - cold hands
      - poor circulation
      - low perfusion
      - movement artifact
      - sensor fit
      - nail polish
      - artificial nails
      - tobacco exposure
      - carbon monoxide exposure
      - methemoglobinemia or dyes
      - altitude
      - acute respiratory infection
      - asthma or COPD flare
      - pneumonia
      - sleep apnea
      - supplemental oxygen
      - device firmware changes
relations:
  -
    type: related_protocol
    target: protocol_variant:red-light-glasses-before-bed/red-light-glasses-before-bed
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: related_protocol
    target: protocol_variant:norwegian-4x4/norwegian-4x4
  -
    type: cites
    target: source_artifact:fda-pulse-oximeter-basics-2025
  -
    type: cites
    target: source_artifact:fda-pulse-oximeter-skin-tone-guidance-2025
  -
    type: cites
    target: source_artifact:pmid-29262014
  -
    type: cites
    target: source_artifact:mayo-hypoxemia-pulse-oximetry
  -
    type: cites
    target: source_artifact:cleveland-clinic-blood-oxygen-level
  -
    type: cites
    target: source_artifact:pmid-28162150
claims:
  -
    claimId: spo2-readings-are-estimates
    type: design_guardrail
    text: Home pulse oximeters and consumer wearables estimate oxygen saturation and should be interpreted alongside symptoms, device instructions, and measurement conditions rather than as interchangeable clinical-grade verdicts.
    strength: high
    sourceKeys:
      - source_artifact:fda-pulse-oximeter-basics-2025
      - source_artifact:pmid-29262014
    caveats:
      - Medical pulse oximeters, general-wellness wearables, and arterial blood gas testing have different validation targets and should not be collapsed into one confidence bucket.
  -
    claimId: spo2-skin-tone-perfusion-and-motion-can-bias-readings
    type: design_guardrail
    text: Skin pigmentation, low perfusion, motion, nail polish, cold hands, and sensor fit can bias SpO₂ readings enough that Murph should keep measurement caveats visible next to the trend.
    strength: high
    sourceKeys:
      - source_artifact:fda-pulse-oximeter-skin-tone-guidance-2025
      - source_artifact:fda-pulse-oximeter-basics-2025
      - source_artifact:pmid-29262014
    caveats:
      - Device firmware, smoothing, and sensor placement can add extra error that is not obvious from a single displayed number.
  -
    claimId: spo2-overnight-desaturation-is-follow-up-context
    type: evidence_scope
    text: Repeated overnight desaturation patterns can be useful follow-up context, but consumer SpO₂ data alone should not be used to diagnose obstructive sleep apnea or other causes of hypoxemia.
    strength: high
    sourceKeys:
      - source_artifact:pmid-28162150
      - source_artifact:fda-pulse-oximeter-basics-2025
      - source_artifact:pmid-29262014
    caveats:
      - Snoring, witnessed apneas, daytime sleepiness, morning headaches, or cardiopulmonary risk factors increase the value of clinical evaluation and validated sleep testing.
  -
    claimId: spo2-low-readings-with-symptoms-need-escalation-context
    type: safety
    text: Low or falling SpO₂ readings paired with shortness of breath, chest pain, confusion, bluish lips or nails, or rapidly worsening illness should be treated as clinical context and escalated according to the user's care plan or urgent-care instructions.
    strength: high
    sourceKeys:
      - source_artifact:mayo-hypoxemia-pulse-oximetry
      - source_artifact:cleveland-clinic-blood-oxygen-level
      - source_artifact:fda-pulse-oximeter-basics-2025
    caveats:
      - Clinician-specific oxygen targets, high altitude, supplemental oxygen, and chronic lung or cardiac disease can change what counts as abnormal for a specific person.
protocolRanking:
  version: deterministic-v0
  scoreFormula: evidenceWeight * 3 + biomarkerRelevance * 3 + wearableMeasurability * 2 - burdenPenalty - safetyCautionPenalty + communityOutcomeConfidence
  candidates:
    -
      protocolKey: protocol_variant:red-light-glasses-before-bed/red-light-glasses-before-bed
      expectedDirection: stable
      relationship: related_protocol
      mechanism: "Evening light reduction may improve sleep timing or continuity, but it does not treat sleep apnea or hypoxemia. SpO₂ should remain stable; repeated overnight drops would be a safety-context signal rather than proof the protocol is working."
      scoring:
        evidenceWeight: 1
        biomarkerRelevance: 1
        wearableMeasurability: 5
        burdenPenalty: 1
        safetyCautionPenalty: 1
      display:
        confidence: low
        burdenLabel: Low
        cautionLabel: Low
    -
      protocolKey: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
      expectedDirection: stable
      relationship: related_protocol
      mechanism: "Sauna is a heat-stress and recovery experiment, not an oxygenation intervention. Tracking SpO₂ is mainly a guardrail: stable readings are reassuring, while symptom-matched lows after heat, dehydration, illness, or respiratory strain should not be ignored."
      scoring:
        evidenceWeight: 1
        biomarkerRelevance: 1
        wearableMeasurability: 5
        burdenPenalty: 2
        safetyCautionPenalty: 2
      display:
        confidence: low
        burdenLabel: Moderate
        cautionLabel: Moderate
    -
      protocolKey: protocol_variant:norwegian-4x4/norwegian-4x4
      expectedDirection: stable
      relationship: related_protocol
      mechanism: "Aerobic interval training targets cardiorespiratory fitness and estimated VO₂max, but resting or overnight SpO₂ is tightly regulated in healthy users. Use it as a safety and illness-context check, not as the primary success marker for 4x4 training."
      scoring:
        evidenceWeight: 1
        biomarkerRelevance: 1
        wearableMeasurability: 5
        burdenPenalty: 4
        safetyCautionPenalty: 3
      display:
        confidence: low
        burdenLabel: High
        cautionLabel: Higher
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Early Murph outcome summaries will appear here once enough opted-in experiment runs are available.
---

SpO₂ is the pulse-oximetry estimate of arterial oxygen saturation: the percentage of hemoglobin binding sites carrying oxygen at the moment of measurement. In consumer health tracking, it is best treated as a respiratory and sleep-context biomarker, not as a score to maximize.

## Practical baseline

Many healthy sea-level adults will usually see readings in the mid-to-high 90s. The exact acceptable range is contextual: altitude, chronic lung disease, congenital or cardiac conditions, medication effects, recent respiratory illness, and clinician-directed oxygen targets can all change what is normal for a specific person.

For Murph, the most useful pattern is not “highest possible SpO₂.” It is whether the value remains stable in the user's own normal range and whether there are repeated unexplained lows, especially overnight or during illness.

## Daytime spot checks versus overnight wearable trends

A careful finger pulse-oximeter spot check is useful when the user has symptoms or wants a same-moment reading. It should be done with a warm hand, minimal movement, good sensor fit, and awareness of nail polish, skin temperature, and circulation.

Wearable overnight SpO₂ is better for repeated trend context. It can surface patterns that may be relevant to sleep-disordered breathing, altitude, alcohol, respiratory illness, or recovery strain. However, wrist and ring sensors are not the same thing as a diagnostic sleep study, and movement or fit artifacts can create false dips.

## Interpretation rules for this page

Use same-device 7-day medians against a longer personal baseline. Separate daytime readings from overnight readings. Keep symptom notes, altitude, illness, supplemental oxygen use, device changes, and sleep-quality changes visible next to the trend.

A stable median does not rule out short desaturation events. A single low wearable datapoint does not diagnose disease. Repeated lows, drops from personal baseline, or lows paired with shortness of breath, chest pain, confusion, blue lips or nails, severe fatigue, or rapidly worsening illness deserve clinical context.

## Why this is not an optimization target

In healthy users, SpO₂ already operates near a physiological ceiling. Exercise, sauna, sleep hygiene, and light protocols may improve other biomarkers without moving SpO₂ at all. That is not a failure. Murph should score most wellness protocols against their true primary endpoints and use SpO₂ as a guardrail, confounder, and respiratory-safety context marker.

## Source posture

This page uses FDA pulse-oximeter guidance for device and home-monitoring caveats, clinical references for broad oxygen-saturation context, and sleep-medicine diagnostic guidance to avoid treating consumer overnight oxygen trends as a diagnosis of obstructive sleep apnea.
