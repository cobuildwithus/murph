---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-overweight-obesity-management-2026-01-08
slug: sources/prolonged-fasting/nice-overweight-obesity-management-2026-01-08
title: 'Overweight and obesity management: physical activity and diet recommendations, including very-low-energy diets'
summary: NICE recommends low-energy and very-low-energy diets only as nutritionally complete, time-limited, clinically supported interventions with supervision and transition back to sustainable eating.
status: draft
quality: usable
aliases:
- nice-overweight-obesity-management-2026-01-08
categories:
- prolonged-fasting
relations:
- type: related_protocol
  target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
- type: parent_family
  target: experiment_family:prolonged-fasting
source:
  kind: guideline
  title: 'Overweight and obesity management: physical activity and diet recommendations, including very-low-energy diets'
  authors: National Institute for Health and Care Excellence (NICE)
  year: 2026
  journal: NICE Guideline NG246
  citation: National Institute for Health and Care Excellence. Overweight and obesity management. NICE guideline NG246. Published 14 January 2025; last reviewed 8 January 2026.
  url: https://nice.org.uk/guidance/ng246
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 271ddf905e68b4c3678b171483efbcaa6f267df86a122db7b4c36fdf4a44ec75
    url: https://nice.org.uk/guidance/ng246
  canonicalUrl: https://nice.org.uk/guidance/ng246
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline for overweight and obesity management
  populationLabel: Children, young people, and adults covered by NICE overweight and obesity management guidance; low-energy/VLED recommendations apply to adults.
  durationLabel: Guideline recommendations; VLED/LED use limited to defined supervised periods.
  aggregateRole: primary
  cohortKey: batch-004
evidenceBucket: FMD/VLCD and modified-fasting boundary
whyItMatters: Provides the safety and supervision boundary for very-low-energy diets, which are sometimes confused with fasting protocols.
potentialMurphEndpoints:
- safety:supervision
- safety:medication-review
- safety:refeeding-transition
- symptom:fatigue
- symptom:constipation
protocolTakeaway: Use as safety-boundary guidance; it is not efficacy evidence for a self-directed 24–72 hour prolonged fast.
murphTakeaway: Supports screening, medication-review, eating-disorder caution, and refeeding-transition language for severe restriction.
studyDesign: Clinical guideline for overweight and obesity management
modality: Clinical guideline for very-low-energy diets
claimUse: safety-only
sourceFindings:
- findingId: finding:nice-overweight-obesity-management-2026-01-08:batch-004-boundary
  sourceKey: source_artifact:nice-overweight-obesity-management-2026-01-08
  extractedFromArtifactId: art_batch004_nice_overweight_obesity_management_2026_01_08
  findingKind: safety
  population: Children, young people, and adults covered by NICE overweight and obesity management guidance; low-energy/VLED recommendations apply to adults.
  exposure: Low-energy and very-low-energy diets as clinical weight-management tools.
  outcome: safety:supervision; safety:medication-review; safety:refeeding-transition; symptom:fatigue; symptom:constipation
  summary: 'NICE recommends low-energy and very-low-energy diets only as nutritionally complete, time-limited, clinically supported interventions with supervision and transition back to sustainable eating. Limitations/directness: Guideline recommendations are for weight management services, not single water-only fast experiments. Population mismatch: Applies to clinical obesity management and VLED/LED programs rather than a discrete 24–72 hour zero-calorie protocol.'
  evidenceUse:
  - safety
  - context
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **FMD/VLCD and modified-fasting boundary**.

**Findings:** NICE recommends low-energy and very-low-energy diets only as nutritionally complete, time-limited, clinically supported interventions with supervision and transition back to sustainable eating.

**Why it matters:** Provides the safety and supervision boundary for very-low-energy diets, which are sometimes confused with fasting protocols.

**Potential experiment signals:** safety:supervision, safety:medication-review, safety:refeeding-transition, symptom:fatigue, symptom:constipation.

**Protocol takeaway:** Use as safety-boundary guidance; it is not efficacy evidence for a self-directed 24–72 hour prolonged fast.

**Directness and limitations:** Directness is `adjacent_variant`. Guideline recommendations are for weight management services, not single water-only fast experiments. Population mismatch: Applies to clinical obesity management and VLED/LED programs rather than a discrete 24–72 hour zero-calorie protocol.

**Claim use:** `safety-only`.
