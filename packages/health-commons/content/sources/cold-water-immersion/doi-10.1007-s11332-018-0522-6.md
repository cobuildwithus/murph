---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1007-s11332-018-0522-6
slug: sources/cold-water-immersion/doi-10.1007-s11332-018-0522-6
title: The effects of cold water immersion on the amount and quality of sleep obtained by elite cyclists during a simulated hill climbing tour
summary: Post-exercise cold-water immersion shortened sleep latency versus placebo ultrasound, but did not clearly change total sleep amount or sleep quality in elite cyclists.
status: draft
quality: usable
categories:
- cold-water-immersion
- cold-plunge
relations:
- type: parent_family
  target: experiment_family:cold-water-immersion
- type: related_protocol
  target: protocol_variant:cold-water-immersion/cold-plunge
source:
  kind: journal_article
  title: The effects of cold water immersion on the amount and quality of sleep obtained by elite cyclists during a simulated hill climbing tour
  authors: Lastella M; Roach GD; Halson SL; Sargent C
  year: 2019
  journal: Sport Sciences for Health
  doi: 10.1007/s11332-018-0522-6
  url: https://doi.org/10.1007/s11332-018-0522-6
  citation: Lastella M; Roach GD; Halson SL; Sargent C. The effects of cold water immersion on the amount and quality of sleep obtained by elite cyclists during a simulated hill climbing tour. Sport Sciences for Health. 2019. doi:10.1007/s11332-018-0522-6.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1007/s11332-018-0522-6
    titleHash: f2192853f9b0ce7e38716c368892357d7a34da73d82541cc183c73e0c410a781
    url: https://doi.org/10.1007/s11332-018-0522-6
  canonicalUrl: https://doi.org/10.1007/s11332-018-0522-6
  identityAliases:
  - DOI 10.1007/s11332-018-0522-6
  - The effects of cold water immersion on the amount and quality of sleep obtained by elite cyclists during a simulated hill climbing tour
researchEvidence:
  designKind: crossover_trial
  designLabel: Randomized crossover trial during a simulated hill-climbing cycling tour
  populationLabel: Male professional cyclists
  durationLabel: Two intervention blocks during an 8-night simulated hill-climbing tour
  cohortKey: cohort:doi-10-1007-s11332-018-0522-6
  participantCount: 10
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Cold Plunge extraction context: bucket=Sleep, HRV, and recovery context; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10.1007-s11332-018-0522-6:sleep-latency-only
  sourceKey: source_artifact:doi-10.1007-s11332-018-0522-6
  extractedFromArtifactId: art_doi_10_1007_s11332_018_0522_6
  findingKind: intervention_result
  population: Male professional cyclists during a simulated hill-climbing tour
  exposure: Post-exercise CWI at approximately 11-12°C for 10 minutes
  outcome: Sleep latency, amount, and quality
  summary: The crossover study reported shorter sleep latency with CWI versus placebo ultrasound, while overall sleep amount and sleep quality were not clearly different.
  evidenceUse:
  - adjacent_variant
  - measurement
- findingId: finding:doi-10.1007-s11332-018-0522-6:athlete-boundary
  sourceKey: source_artifact:doi-10.1007-s11332-018-0522-6
  extractedFromArtifactId: art_doi_10_1007_s11332_018_0522_6
  findingKind: context
  population: Elite cyclists
  exposure: CWI embedded in a cycling recovery schedule
  outcome: Generalizability
  summary: The source is best treated as athlete recovery context rather than direct evidence for a general wellness cold-plunge protocol.
  evidenceUse:
  - context
coldPlungeExtraction:
  batchId: batch-007
  evidenceBucket: Sleep, HRV, and recovery context
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: paywalled
  identityResolutionStatus: new_source
aliases:
- DOI 10.1007/s11332-018-0522-6
- The effects of cold water immersion on the amount and quality of sleep obtained by elite cyclists during a simulated hill climbing tour
- 10.1007/s11332-018-0522-6
---

This source is included for **Sleep, HRV, and recovery context**.

**Findings:** The crossover study reported shorter sleep latency with CWI versus placebo ultrasound, while overall sleep amount and sleep quality were not clearly different.; The source is best treated as athlete recovery context rather than direct evidence for a general wellness cold-plunge protocol.

**Why it matters:** One of the more directly sleep-focused post-exercise CWI studies, but the athlete/tour setting and narrow sleep-latency result limit general cold-plunge claims.

**Potential experiment signals:** biomarker:sleep-onset-latency, biomarker:sleep-efficiency, self_report:sleep_quality.

**Protocol takeaway:** Cold plunge pages can cite this only as adjacent athlete evidence with a sleep-latency signal and otherwise null sleep-quantity/quality findings.

**Claim use:** `context-only`.
