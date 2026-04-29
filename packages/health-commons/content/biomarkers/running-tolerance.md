---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:running-tolerance
slug: biomarkers/running-tolerance
title: Running Tolerance
summary: Pain-limited run/walk duration and interval tolerance used to guide gradual return to running.
status: draft
quality: usable
categories:
  - running
  - rehabilitation
  - manual-log
relations:

  -
    type: related_protocol
    target: protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
measurementContexts:
  - itbs_return_to_run
  - manual_checkin
unit: minutes
interpretationFrame:
  principle: Increase run/walk exposure only when current exposure stays tolerable during the session and the next day.
  caveat: More minutes are not better if pain, limping, or next-day symptoms worsen.
biomarker:
  shortName: Running Tolerance
  displayName: Running Tolerance
  unit: minutes
  valuePrecision: 1
  direction:
    desired: higher_or_stable
    label: More pain-free or low-pain running time can be favorable.
    nuance: Progression should stop when pain changes gait or rebounds later.
  measurement:
    bestContext: Track total run/walk duration, longest run interval, and whether symptoms stayed mild.
    howToMeasure:
      - Log run minutes and walk minutes separately.
      - Record terrain, hills, camber, and effort.
      - Compare next-day pain before progressing.
    confounders:
      - running_volume
      - pace_change
      - hills_or_downhill
      - terrain_camber
      - footwear_change
      - cycling_load
---

Pain-limited running exposure used to guide a graded return-to-run progression.
