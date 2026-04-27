---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:daily-protein-g-per-kg
slug: biomarkers/daily-protein-g-per-kg
title: Daily Protein g/kg
summary: Primary achieved-exposure marker for total daily protein relative to the chosen denominator.
status: draft
quality: usable
categories:
- nutrition
- protein-floor
relations:
-
  type: related_protocol
  target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
unit: g/kg/day
interpretationFrame:
  principle: Compare baseline and intervention windows using the same measurement method and context.
  caveat: This marker is part of interpretation or safety context; abnormal clinical labs or symptoms should be reviewed with an appropriate clinician.
---

Primary achieved-exposure marker for total daily protein relative to the chosen denominator.

For the Protein Floor protocol, treat this marker as an exposure, outcome, interpretation, or safety-context signal according to the protocol test plan rather than as a stand-alone diagnosis.
