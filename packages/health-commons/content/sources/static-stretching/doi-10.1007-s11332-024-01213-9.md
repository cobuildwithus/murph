---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1007/s11332-024-01213-9"
slug: "sources/static-stretching/doi-10.1007-s11332-024-01213-9"
title: "Stretching intervention can prevent muscle injuries: A systematic review and meta-analysis"
summary: "Recent meta-analysis reported a muscle-injury reduction signal but not a clear tendon-injury reduction, based on few studies."
status: "draft"
quality: "usable"
aliases:
  - "Takeuchi K 2024 Stretching intervention can prevent muscle injuries: A syste"
  - "Stretching intervention can prevent muscle injuries: A systematic review and meta-analysis"
categories:
  - "static-stretching"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:static-stretching/at-home-static-stretching-for-flexibility"
  -
    type: "parent_family"
    target: "experiment_family:static-stretching"
source:
  kind: "review"
  title: "Stretching intervention can prevent muscle injuries: A systematic review and meta-analysis"
  authors: "Takeuchi K; Nakamura M; Fukaya T; Nakao G; Mizuno T"
  year: 2024
  journal: "Sport Sciences for Health"
  citation: "Takeuchi K; Nakamura M; Fukaya T; Nakao G; Mizuno T. Stretching intervention can prevent muscle injuries: A systematic review and meta-analysis. Sport Sciences for Health. 2024. doi:10.1007/s11332-024-01213-9."
  doi: "10.1007/s11332-024-01213-9"
  url: "https://doi.org/10.1007/s11332-024-01213-9"
researchEvidence:
  designKind: "meta_analysis"
  designLabel: "Systematic review and meta-analysis of stretching interventions for muscle and tendon injury prevention"
  includedStudyCount: 4
  populationLabel: "Athletes or active participants in injury-prevention stretching studies"
  durationLabel: "Varied across included trials"
  aggregateRole: "synthesis"
  aggregationNote: "Aggregate evidence source; use for landscape context rather than direct protocol synthesis."
  cohortKey: "doi-10.1007-s11332-024-01213-9"
  notes:
    - "adjacent_variant: stretching for muscle-injury prevention, not flexibility self-experiment efficacy"
    - "Claim boundary: Use as cautious adjacent evidence only; do not promise injury prevention for at-home stretching."
evidenceBucket: "adverse_event_clinical_population_mismatch"
whyItMatters: "It preserves a possible positive adjacent injury signal while acknowledging limited directness and evidence volume."
potentialMurphEndpoints:
  - "muscle injury incidence"
  - "tendon injury incidence"
protocolTakeaway: "Injury prevention should remain a cautious secondary context, not the protocol’s claimed outcome."
murphTakeaway: "Users may track strains and training load, but flexibility change remains the primary endpoint."
studyDesign: "Systematic review with meta-analysis"
modality: "Stretching for injury prevention"
claimUse: "safety-only"
murphV1Priority: "Medium"
pdfRightsStatus: "permission_required"
---

This source is included for **adverse_event_clinical_population_mismatch**.

**Findings:** The analysis reported lower odds of muscle injuries with stretching (OR 0.37, 95% CI 0.16 to 0.85) but no statistically clear tendon-injury reduction (OR 0.57, 95% CI 0.25 to 1.33). Heterogeneity was reported for injury outcomes. Source key: `source_artifact:doi-10.1007/s11332-024-01213-9`.

**Adverse events or safety notes:** No adverse-event extraction was available; source is used for mixed injury-prevention context.

**Limitations and population mismatch:** Injury-prevention evidence in athletic contexts, not direct home flexibility training. Limitations: Only four papers were included.; Injury-prevention trial settings and athletic populations are adjacent to a home flexibility protocol..

**Why it matters:** It preserves a possible positive adjacent injury signal while acknowledging limited directness and evidence volume.

**Potential experiment signals:** muscle injury incidence, tendon injury incidence.

**Protocol takeaway:** Injury prevention should remain a cautious secondary context, not the protocol’s claimed outcome.

**Claim use:** `safety-only`. Boundary: Use as cautious adjacent evidence only; do not promise injury prevention for at-home stretching.
