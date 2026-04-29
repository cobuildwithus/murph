---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:morning-blood-pressure
slug: biomarkers/morning-blood-pressure
title: Morning Blood Pressure
summary: An optional home blood-pressure marker that can add real signal to the dry-sauna experiment when the same cuff, posture, and timing are used consistently.
status: draft
quality: usable
aliases:
  - home blood pressure
  - morning BP
categories:
  - cardiovascular
  - recovery
  - home-measurement
relations:

  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: cites
    target: source_artifact:pmid-29269746
  -
    type: cites
    target: source_artifact:pmid-31126559
  -
    type: cites
    target: source_artifact:pmid-28633297
  -
    type: cites
    target: source_artifact:pmid-38410962
measurementContexts:
  - morning_home_cuff
  - validated_home_bp_monitor
unit: mmHg
components:
  - systolic
  - diastolic
interpretationFrame:
  principle: Use the same cuff, posture, rest period, and time window, then compare baseline averages against intervention averages.
  caveat: Single post-sauna readings are not the same as stable morning home blood-pressure trends.
---

Morning blood pressure is optional for this dry-sauna experiment, but it is worth collecting if you already have a validated home cuff and can measure it the same way each time.

A good home protocol is simple:

- measure on waking or in the same early-morning window,
- sit quietly for several minutes first,
- use the same cuff on the same arm,
- avoid comparing rushed readings against calm readings,
- look at baseline-average versus intervention-average movement rather than one dramatic single day.

Treat morning blood pressure as a **valuable optional secondary signal**, not as a requirement for every user.
