---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:lean-mass
slug: biomarkers/lean-mass
title: Lean Mass
summary: Optional body-composition marker that depends strongly on measurement method and training context.
status: draft
quality: usable
categories:
- health-marker
- protein-floor
relations:
-
  type: related_protocol
  target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
unit: kg
interpretationFrame:
  principle: Compare baseline and intervention windows using the same measurement method and context.
  caveat: This marker is part of interpretation or safety context; abnormal clinical labs or symptoms should be reviewed with an appropriate clinician.
biomarker:
  direction:
    desired: higher_or_stable
    label: More or stable lean mass is generally desirable.
---

Optional body-composition marker that depends strongly on measurement method and training context.

For the Protein Floor protocol, treat this marker as an exposure, outcome, interpretation, or safety-context signal according to the protocol test plan rather than as a stand-alone diagnosis.
