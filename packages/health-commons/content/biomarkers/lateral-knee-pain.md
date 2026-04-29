---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:lateral-knee-pain
slug: biomarkers/lateral-knee-pain
title: Lateral Knee Pain
summary: A manual symptom rating for outside-of-knee pain during running, after running, and the next morning.
status: draft
quality: usable
categories:
  - pain
  - running
  - manual-log
relations:

  -
    type: related_protocol
    target: protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
measurementContexts:
  - itbs_return_to_run
  - manual_checkin
unit: 0_to_10
interpretationFrame:
  principle: Compare pain at baseline, during the run, later the same day, and the next morning before progressing running load.
  caveat: Pain location and behavior matter; swelling, locking, trauma, fever, or inability to bear weight should override the experiment.
biomarker:
  shortName: Lateral Knee Pain
  displayName: Lateral Knee Pain
  unit: 0_to_10
  valuePrecision: 1
  direction:
    desired: lower_or_stable
    label: Lower or stable pain during progression is favorable.
    nuance: Stable pain is only acceptable if gait is normal and symptoms do not rebound later or the next day.
  measurement:
    bestContext: Rate lateral knee pain before running, peak during running, later the same day, and next morning.
    howToMeasure:
      - Use the same 0-10 scale each time.
      - Record whether pain changed gait or forced a stop.
      - Record next-day response before increasing run duration.
    confounders:
      - running_volume
      - hills_or_downhill
      - terrain_camber
      - footwear_change
      - cycling_load
      - strength_session_soreness
---

A manual symptom rating for lateral knee pain during ITBS return-to-run work.
