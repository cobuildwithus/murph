---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:blood-pressure
slug: biomarkers/blood-pressure
title: Blood Pressure
summary: Optional home or clinical blood-pressure marker for cardiovascular and source-quality context.
status: draft
quality: usable
categories:
- health-marker
- protein-floor
relations:
-
  type: related_protocol
  target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
unit: mmHg
interpretationFrame:
  principle: Compare baseline and intervention windows using the same measurement method and context.
  caveat: This marker is part of interpretation or safety context; abnormal clinical labs or symptoms should be reviewed with an appropriate clinician.
---

Optional home or clinical blood-pressure marker for cardiovascular and source-quality context.

For the Protein Floor protocol, treat this marker as an exposure, outcome, interpretation, or safety-context signal according to the protocol test plan rather than as a stand-alone diagnosis.
