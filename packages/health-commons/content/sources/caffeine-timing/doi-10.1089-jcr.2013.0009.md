---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1089-jcr.2013.0009
slug: sources/caffeine-timing/doi-10.1089-jcr.2013.0009
title: 'Impact of Caffeine on Heart Rate Variability: A Systematic Review'
summary: A systematic review of 13 caffeine-HRV studies involving 325 participants found heterogeneous evidence, with the strongest signal suggesting caffeine may increase vagally mediated HRV components, while design and measurement differences prevented firm conclusions.
status: draft
quality: usable
aliases:
- 'Impact of Caffeine on Heart Rate Variability: A Systematic Review'
- source_artifact:doi-10.1089-jcr.2013.0009
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: review
  title: 'Impact of Caffeine on Heart Rate Variability: A Systematic Review'
  authors: Julian Koenig; Marc N. Jarczok; Wolfgang Kuhn; Katharina Morsch; Alexander Schäfer; Thomas K. Hillecke; Julian F. Thayer
  year: 2013
  journal: Journal of Caffeine Research
  citation: 'Koenig J, Jarczok MN, Kuhn W, Morsch K, Schäfer A, Hillecke TK, Thayer JF. Impact of caffeine on heart rate variability: a systematic review. Journal of Caffeine Research. 2013;3(1):22-37. doi:10.1089/jcr.2013.0009.'
  doi: 10.1089/jcr.2013.0009
  url: https://doi.org/10.1089/jcr.2013.0009
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1089/jcr.2013.0009
    titleHash: 48c8c0d69e5cff61884d6afa70af96d9f73f0f6ea59014f57aa909e1d45b19e0
    url: https://doi.org/10.1089/jcr.2013.0009
  canonicalUrl: https://doi.org/10.1089/jcr.2013.0009
researchEvidence:
  designKind: systematic_review
  designLabel: Systematic review
  populationLabel: Mostly healthy adults, with some clinical samples, across caffeine-HRV studies.
  durationLabel: Short-term post-caffeine HRV observation windows; not a sleep-curfew intervention.
  aggregateRole: context
  cohortKey: doi-10.1089-jcr.2013.0009-review-context
  notes:
  - 'Intervention or exposure: Acute caffeine exposure in heterogeneous doses and preparations.'
  - 'Comparator or control: Placebo, control, or pre-post comparisons as reported by included studies.'
  - 'Effect or direction: The review found the best available evidence for an increase in vagally mediated HRV components after caffeine, but concluded the evidence remained unclear because study designs, samples, and HRV methods differed.'
  - 'Safety notes: No sleep-specific safety synthesis; HRV interpretation is limited by heterogeneous measurement methods.'
  - 'Population mismatch: HRV studies were not designed around bedtime caffeine curfews or consumer wearable recovery metrics.'
  - 'Limitation: HRV-focused and not sleep-outcome-specific.'
  - 'Limitation: Small total participant pool and heterogeneous populations, caffeine doses, and HRV methods.'
  participantCount: 325
  participantCountKind: reported
  includedStudyCount: 13
evidenceBucket: systematic_reviews_meta_analyses
whyItMatters: Useful for interpreting whether caffeine can perturb autonomic metrics such as RMSSD, while guarding against treating HRV movement as a direct sleep-quality outcome.
potentialMurphEndpoints:
- Overnight HRV RMSSD
- resting heart rate
protocolTakeaway: Use as autonomic-mechanism and measurement context only; do not infer that curfew adherence will reliably raise or lower HRV.
murphTakeaway: If HRV changes during a caffeine curfew, treat the signal as plausibly caffeine-related but not sleep-specific without corroborating sleep and symptom data.
studyDesign: systematic_review
modality: hrv-autonomic-context
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10.1089-jcr.2013.0009-caffeine-hrv-heterogeneous
  sourceKey: source_artifact:doi-10.1089-jcr.2013.0009
  extractedFromArtifactId: art_doi-10.1089-jcr.2013.0009_html
  findingKind: measurement_validation
  population: Mostly healthy adults, with some clinical samples, across caffeine-HRV studies.
  exposure: Acute caffeine exposure in heterogeneous doses and preparations.
  outcome: Heart rate variability; high-frequency HRV; RMSSD and other vagally mediated indices
  summary: A systematic review of 13 caffeine-HRV studies involving 325 participants found heterogeneous evidence, with the strongest signal suggesting caffeine may increase vagally mediated HRV components, while design and measurement differences prevented firm conclusions.
  evidenceUse:
  - measurement
  - mechanism
  - context
murphV1Priority: Medium
pdfRightsStatus: permission_required
---

This source is included for **systematic_reviews_meta_analyses**.

**Findings:** A systematic review of 13 caffeine-HRV studies involving 325 participants found heterogeneous evidence, with the strongest signal suggesting caffeine may increase vagally mediated HRV components, while design and measurement differences prevented firm conclusions.

**Why it matters:** Useful for interpreting whether caffeine can perturb autonomic metrics such as RMSSD, while guarding against treating HRV movement as a direct sleep-quality outcome.

**Potential experiment signals:** Overnight HRV RMSSD, resting heart rate.

**Protocol takeaway:** Use as autonomic-mechanism and measurement context only; do not infer that curfew adherence will reliably raise or lower HRV.

**Claim use:** `context-only`.
