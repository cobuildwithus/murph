---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:saturated-fat-g-day
slug: biomarkers/saturated-fat-g-day
title: Saturated Fat
summary: Source-quality guardrail marker when protein-source changes affect saturated-fat intake.
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
    desired: lower_or_stable
    label: Lower or stable saturated-fat intake within the planned range is generally preferred.
---

Source-quality guardrail marker when protein-source changes affect saturated-fat intake.

For the Protein Floor protocol, treat this marker as an exposure, outcome, interpretation, or safety-context signal according to the protocol test plan rather than as a stand-alone diagnosis.
