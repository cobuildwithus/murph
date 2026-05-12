---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:dietary-fiber-g-day
slug: biomarkers/dietary-fiber-g-day
title: Dietary Fiber
summary: Fiber guardrail marker used to detect plant-food displacement during higher-protein intake.
status: draft
quality: usable
categories:
- nutrition
- protein-floor
relations:
-
  type: related_protocol
  target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
unit: g/day
interpretationFrame:
  principle: Compare baseline and intervention windows using the same measurement method and context.
  caveat: This marker is part of interpretation or safety context; abnormal clinical labs or symptoms should be reviewed with an appropriate clinician.
biomarker:
  direction:
    desired: higher_or_stable
    label: More fiber, up to the planned intake range, is generally beneficial.
---

Fiber guardrail marker used to detect plant-food displacement during higher-protein intake.

For the Protein Floor protocol, treat this marker as an exposure, outcome, interpretation, or safety-context signal according to the protocol test plan rather than as a stand-alone diagnosis.
