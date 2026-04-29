---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1038-s41598-025-93774-z
slug: sources/deep-sleep/doi-10.1038-s41598-025-93774-z
title: "Performance of wearable finger ring trackers for diagnostic sleep measurement in the clinical context"
summary: Clinical sleep-lab comparison showing that ring tracker averages can mask large individual-level sleep-stage errors.
status: draft
quality: usable
categories:
  - deep-sleep
  - consumer-sleep-technology
  - wearable-validation
  - clinical-context
relations:

  -
    type: measures
    target: biomarker:deep-sleep-minutes
source:
  kind: journal_article
  title: "Performance of wearable finger ring trackers for diagnostic sleep measurement in the clinical context"
  authors: Herberger S, Aurnhammer C, Bauerfeind S, Bothe T, Penzel T, Fietze I
  year: 2025
  journal: Scientific Reports
  citation: "Herberger S, Aurnhammer C, Bauerfeind S, Bothe T, Penzel T, Fietze I. Performance of wearable finger ring trackers for diagnostic sleep measurement in the clinical context. Sci Rep. 2025;15:9461. doi:10.1038/s41598-025-93774-z."
  pmid: "40108409"
  doi: 10.1038/s41598-025-93774-z
  url: https://www.nature.com/articles/s41598-025-93774-z
researchEvidence:
  designKind: controlled_trial
  designLabel: Clinical sleep-lab validation against polysomnography
  populationLabel: University sleep-lab patients with diverse sleep-related and medical conditions
  aggregateRole: context
  notes:
    - Particularly important for the guardrail that consumer ring stage estimates are not clinical sleep-medicine measurements.
evidenceBucket: Clinical wearable-stage caution
whyItMatters: Clinical context shows why average agreement is not enough when an individual wants to interpret one night or one disorder-relevant trend.
potentialMurphEndpoints:
  - deep sleep minutes
  - light sleep minutes
  - REM minutes
  - total sleep time
  - sleep efficiency
murphTakeaway: A consumer stage estimate can be directionally useful but should not be used to diagnose or rule out sleep disorders.
---

This source is included for **clinical-stage accuracy guardrails**. It found that group-level sleep estimates can look acceptable while individual-level stage discrepancies remain large.

**Murph implication:** Deep sleep minutes should never be the sole protocol verdict, and clinical symptoms should route users toward clinical sleep evaluation rather than stage optimization.
