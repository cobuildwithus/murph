---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:hbot-session-tolerability"
slug: "biomarkers/hbot-session-tolerability"
title: "HBOT Session Tolerability"
summary: "A manual session-level safety signal for ear/sinus pressure problems, vision changes, confinement intolerance, glucose or blood-pressure issues, and other adverse events during clinician-supervised HBOT."
status: "draft"
quality: "usable"
aliases:
  - "HBOT adverse-event burden"
  - "HBOT session symptoms"
  - "HBOT tolerability log"
categories:
  - "hyperbaric-oxygen-therapy"
  - "safety"
  - "manual-metric"
  - "recovery"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:hyperbaric-oxygen-therapy/hyperbaric-oxygen-therapy"
  -
    type: "cites"
    target: "source_artifact:pmid-37275378"
  -
    type: "cites"
    target: "source_artifact:pmid-39597979"
  -
    type: "cites"
    target: "source_artifact:pmid-41429031"
  -
    type: "cites"
    target: "source_artifact:pmid-30690920"
  -
    type: "cites"
    target: "source_artifact:pmid-26152103"
measurementContexts:
  - "session_manual_log"
  - "post_session_checkin"
unit: "ordinal score"
interpretationFrame:
  principle: "Lower or stable symptom burden is better; any serious symptom overrides the score."
  caveat: "This is a safety and tolerability log, not a diagnosis and not proof that HBOT is effective for the underlying condition."
biomarker:
  shortName: "HBOT tolerability"
  displayName: "HBOT session tolerability"
  unit: "ordinal score"
  valuePrecision: 0
  direction:
    desired: "lower_or_stable"
    label: "Lower symptom burden is better."
    nuance: "A single severe symptom, unsafe glucose or blood-pressure reading, stopped session, device/facility concern, or staff instruction should override trend interpretation and trigger clinician/facility follow-up."
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 1
    aggregation: "median"
  explainerCards:
    -
      title: "What it is"
      body: "A manual check after each prescribed HBOT session for ear/sinus pressure symptoms, vision change, anxiety or claustrophobia, glucose/BP issues if relevant, and any staff intervention or stopped session."
    -
      title: "Why Murph tracks it"
      body: "The runnable HBOT protocol is safety-first. Tolerability and adverse-event logging are more appropriate for Murph than promising disease-specific efficacy from wearable proxies."
  measurement:
    bestContext: "Complete immediately after each supervised HBOT session, with a follow-up note later the same day if symptoms persist."
    howToMeasure:
      - "Record whether the session was completed as prescribed."
      - "Score ear/sinus symptoms, vision changes, anxiety, glucose/BP issues if relevant, and other adverse events as none, mild, moderate, severe, or stopped session."
      - "Record any staff intervention, pause, shortened session, or clinician/facility instruction."
    confounders:
      - "respiratory infection"
      - "ear or sinus congestion"
      - "diabetes or low glucose"
      - "blood-pressure instability"
      - "anxiety"
      - "medication changes"
      - "device compatibility issues"
claims:
  -
    claimId: "hbot-tolerability-primary-safety-signal"
    type: "safety"
    text: "HBOT tolerability should foreground adverse events that appear repeatedly in the extracted safety literature, especially ear/sinus pressure problems, vision changes, confinement intolerance, glucose or blood-pressure issues, and other events that interrupt or stop treatment."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-37275378"
      - "source_artifact:pmid-39597979"
      - "source_artifact:pmid-41429031"
      - "source_artifact:pmid-30690920"
      - "source_artifact:pmid-26152103"
---

Use this manual signal as the primary Murph outcome when tracking clinician-prescribed HBOT. It is not a disease outcome. It records whether the prescribed exposure was tolerated and whether any safety concern needs clinician or facility follow-up.
