---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:serum-uric-acid
slug: biomarkers/serum-uric-acid
title: Serum Uric Acid
summary: "Uric acid measures circulating urate from purine metabolism, which can matter for gout, kidney, medication, and metabolic context without one value determining a condition."
status: draft
quality: usable
categories:
- health-marker
- protein-floor
relations:
-
  type: related_protocol
  target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
unit: clinical lab
interpretationFrame:
  principle: Compare baseline and intervention windows using the same measurement method and context.
  caveat: This marker is part of interpretation or safety context; abnormal clinical labs or symptoms should be reviewed with an appropriate clinician.
biomarker:
  direction:
    desired: lower_or_stable
    label: Lower or stable uric acid within the healthy range reduces gout risk.
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Uric acid; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies with equation or assay, age, body-size context, hydration, medications, chronicity, and urine findings recorded; the source result range and flag remain authoritative."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Optional gout and urate-context safety lab interpreted clinically when relevant.

For the Protein Floor protocol, treat this marker as an exposure, outcome, interpretation, or safety-context signal according to the protocol test plan rather than as a stand-alone diagnosis.
