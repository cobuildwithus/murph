---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:buchinger-wilhelmi-fasting-tips-2023-09-06
slug: sources/prolonged-fasting/buchinger-wilhelmi-fasting-tips-2023-09-06
title: Our fasting tips
summary: Buchinger Wilhelmi clinic page with practical fasting tips on preparation, adaptation, structured days, movement/rest, hydration, and side-effect handling.
status: draft
quality: usable
aliases:
- Buchinger Wilhelmi fasting tips
- Fasting tips from Buchinger Wilhelmi experts
categories:
- prolonged-fasting
relations:
- type: related_protocol
  target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
- type: parent_family
  target: experiment_family:prolonged-fasting
source:
  kind: external_protocol
  title: Our fasting tips
  authors: Buchinger Wilhelmi / Barbara Philipps
  year: 2023
  journal: Buchinger Wilhelmi
  citation: Buchinger Wilhelmi. Our fasting tips. Published 2023-09-06. Accessed for batch-011.
  url: https://buchinger-wilhelmi.com/en/fasting-tips
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://buchinger-wilhelmi.com/en/fasting-tips
    titleHash: f867e7f6891b679a2a517f683757c98600f79b400ba6343b1dfa59f01c0a3e84
  canonicalUrl: https://buchinger-wilhelmi.com/en/fasting-tips
researchEvidence:
  designKind: expert_protocol
  designLabel: External clinic implementation tips
  populationLabel: Fasting-clinic guests and people seeking general fasting guidance.
  durationLabel: Implementation tips across preparation, fasting days, and symptoms.
  aggregateRole: context
  cohortKey: cohort:prolonged-fasting-buchinger-tips
evidenceBucket: implementation, hydration, and refeed context
whyItMatters: This source provides implementation guardrails for hydration, rest/activity balance, and symptom response without supplying efficacy evidence.
potentialMurphEndpoints:
- fluid intake
- headache
- dizziness
- circulatory symptoms
- activity intensity
- subjective energy
protocolTakeaway: Use as practical context for hydration and symptom handling, not as proof that fasting improves health outcomes.
murphTakeaway: The self-experiment should collect subjective symptoms and hydration/activity context because implementation conditions may strongly affect tolerability.
studyDesign: External clinic protocol / implementation guidance.
modality: Buchinger-style fasting implementation advice.
claimUse: context-only
sourceFindings:
- findingId: finding:buchinger-wilhelmi-fasting-tips-2023-09-06-hydration-rest-side-effects
  findingKind: safety
  population: People following Buchinger Wilhelmi fasting advice.
  exposure: Preparation, adaptation, daily structure, movement/rest pacing, hydration, and side-effect management during fasting.
  outcome: Implementation tolerability and symptom response.
  summary: The tips emphasize preparation, gentle adaptation, a structured day, avoiding strenuous workouts, balancing movement with rest, drinking enough fluid, and responding to side effects such as headache, dizziness, circulatory problems, back pain, and cold feet.
  evidenceUse:
  - safety
  - context
  sourceKey: source_artifact:buchinger-wilhelmi-fasting-tips-2023-09-06
  extractedFromArtifactId: art_buchinger_wilhelmi_fasting_tips_2023_09_06_source_record
murphV1Priority: Medium
pdfRightsStatus: unknown
directnessToProtocol: clinical_supervised
populationMismatch: Clinical guests under expert support may not match unsupervised self-experimenters.
limitations:
- Commercial clinic advice; no control group, no participant denominator, and no extractable effect estimates.
claimUseBoundary: context-only
---

This source is included for **implementation, hydration, and refeed context**.

**Findings:**
- `finding:buchinger-wilhelmi-fasting-tips-2023-09-06-hydration-rest-side-effects` — The tips emphasize preparation, gentle adaptation, a structured day, avoiding strenuous workouts, balancing movement with rest, drinking enough fluid, and responding to side effects such as headache, dizziness, circulatory problems, back pain, and cold feet.

**Why it matters:** This source provides implementation guardrails for hydration, rest/activity balance, and symptom response without supplying efficacy evidence.

**Potential experiment signals:** fluid intake, headache, dizziness, circulatory symptoms, activity intensity, subjective energy.

**Protocol takeaway:** Use as practical context for hydration and symptom handling, not as proof that fasting improves health outcomes.

**Directness to Prolonged Fasting (24–72 Hours):** `clinical_supervised`.

**Population mismatch:** Clinical guests under expert support may not match unsupervised self-experimenters.

**Limitations:** Commercial clinic advice; no control group, no participant denominator, and no extractable effect estimates.

**Claim use:** `context-only`.

**Artifact and rights note:** Source page draft only. PDF rights status: `unknown`. No copyrighted PDF content is included.
