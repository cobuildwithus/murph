---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3389-fnins.2014.00402
slug: sources/caffeine-timing/doi-10.3389-fnins.2014.00402
title: 'Heart rate variability: a tool to explore the sleeping brain?'
summary: This narrative review describes sleep-stage-dependent autonomic patterns, including higher parasympathetic tone during non-REM sleep and more sympathetic predominance during REM sleep, showing why overnight HRV requires sleep-stage context.
status: draft
quality: usable
aliases:
- 'Heart rate variability: a tool to explore the sleeping brain?'
- source_artifact:doi-10.3389-fnins.2014.00402
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: review
  title: 'Heart rate variability: a tool to explore the sleeping brain?'
  authors: Anne Chouchou; Martin Desseilles
  year: 2014
  journal: Frontiers in Neuroscience
  citation: 'Chouchou A, Desseilles M. Heart rate variability: a tool to explore the sleeping brain? Frontiers in Neuroscience. 2014;8:402. doi:10.3389/fnins.2014.00402.'
  doi: 10.3389/fnins.2014.00402
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC4263095
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.3389/fnins.2014.00402
    pmcid: PMC4263095
    titleHash: 1dd95fb72cae0f6d061f95fb2da0a5df688fda15cba33c2b713f19f90c13a8ba
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC4263095
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC4263095
researchEvidence:
  designKind: narrative_review
  designLabel: Narrative review
  populationLabel: Human sleep and HRV literature reviewed for autonomic patterns across sleep stages.
  durationLabel: Not applicable; narrative review of sleep-stage/autonomic evidence.
  aggregateRole: context
  cohortKey: doi-10.3389-fnins.2014.00402-review-context
  notes:
  - 'Intervention or exposure: Sleep-stage physiology and HRV measurement, not a caffeine intervention.'
  - 'Comparator or control: Non-REM versus REM sleep autonomic patterns and related physiological contexts.'
  - 'Effect or direction: The review describes higher parasympathetic tone during normal non-REM sleep and a shift toward sympathetic predominance during REM sleep, illustrating why overnight HRV is stage- and context-dependent.'
  - 'Safety notes: No adverse-event synthesis.'
  - 'Population mismatch: No direct caffeine-curfew intervention or habitual-caffeine reset population.'
  - 'Limitation: Mechanistic and measurement context only.'
  - 'Limitation: HRV during sleep can reflect sleep stage and autonomic state rather than a single sleep-quality score.'
evidenceBucket: systematic_reviews_meta_analyses
whyItMatters: It helps prevent overinterpreting overnight HRV as a simple proxy for caffeine-curfew success.
potentialMurphEndpoints:
- Overnight HRV RMSSD
- sleep-stage estimates from wearables
protocolTakeaway: Use to explain HRV caveats when participants monitor recovery during caffeine timing changes.
murphTakeaway: Overnight HRV shifts should be interpreted alongside sleep stage, awakenings, dose timing, and subjective recovery.
studyDesign: narrative_review
modality: sleep-hrv-measurement-context
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10.3389-fnins.2014.00402-sleep-stage-hrv-context
  sourceKey: source_artifact:doi-10.3389-fnins.2014.00402
  extractedFromArtifactId: art_doi-10.3389-fnins.2014.00402_html
  findingKind: measurement_validation
  population: Human sleep and HRV literature reviewed for autonomic patterns across sleep stages.
  exposure: Sleep-stage physiology and HRV measurement, not a caffeine intervention.
  outcome: HRV during sleep; parasympathetic and sympathetic autonomic patterns; sleep-stage context
  summary: This narrative review describes sleep-stage-dependent autonomic patterns, including higher parasympathetic tone during non-REM sleep and more sympathetic predominance during REM sleep, showing why overnight HRV requires sleep-stage context.
  evidenceUse:
  - measurement
  - context
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **systematic_reviews_meta_analyses**.

**Findings:** This narrative review describes sleep-stage-dependent autonomic patterns, including higher parasympathetic tone during non-REM sleep and more sympathetic predominance during REM sleep, showing why overnight HRV requires sleep-stage context.

**Why it matters:** It helps prevent overinterpreting overnight HRV as a simple proxy for caffeine-curfew success.

**Potential experiment signals:** Overnight HRV RMSSD, sleep-stage estimates from wearables.

**Protocol takeaway:** Use to explain HRV caveats when participants monitor recovery during caffeine timing changes.

**Claim use:** `context-only`.
