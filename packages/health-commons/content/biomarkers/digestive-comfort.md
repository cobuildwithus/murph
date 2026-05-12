---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:digestive-comfort
slug: biomarkers/digestive-comfort
title: Digestive Comfort
summary: Digestive tolerability marker for constipation, diarrhea, reflux, bloating, nausea, and abdominal pain context.
status: draft
quality: usable
categories:
- nutrition
- protein-floor
relations:
-
  type: related_protocol
  target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
unit: rating
interpretationFrame:
  principle: Compare baseline and intervention windows using the same measurement method and context.
  caveat: This marker is part of interpretation or safety context; abnormal clinical labs or symptoms should be reviewed with an appropriate clinician.
biomarker:
  direction:
    desired: higher_or_stable
    label: More comfortable, stable digestion is the goal.
---

Digestive tolerability marker for constipation, diarrhea, reflux, bloating, nausea, and abdominal pain context.

For the Protein Floor protocol, treat this marker as an exposure, outcome, interpretation, or safety-context signal according to the protocol test plan rather than as a stand-alone diagnosis.
