---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sauna-bibliography-2026-04-18
slug: sources/sauna/sauna-bibliography-2026-04-18
title: Sauna research bibliography
summary: Research map for the Finnish dry-sauna experiment, summarizing the sauna literature review, long-term context, short-term physiology, and dose-design caveats.
status: field-testing
quality: usable
categories:
  - sauna
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: related_protocol
    target: experiment_family:dry-sauna
  -
    type: parent_family
    target: experiment_family:sauna
  -
    type: cites
    target: source_artifact:pmid-16871826
  -
    type: cites
    target: source_artifact:pmid-29849692
  -
    type: cites
    target: source_artifact:mayo-2018-sauna-review
  -
    type: cites
    target: source_artifact:pmid-32814462
  -
    type: cites
    target: source_artifact:pmid-38577299
source:
  kind: other
  title: Sauna research bibliography
  authors: Health Commons Research
  year: 2026
  journal: Health Commons research curation
  citation: Health Commons Research. Sauna research bibliography. Prepared 2026-04-18.
evidenceBucket: Research curation
whyItMatters: This is the structured source map behind the first dry-sauna experiment and evidence review.
potentialMurphEndpoints:
  - Protocol design
  - source discovery
  - evidence map
  - safety-screening bibliography
protocolTakeaway: Treat this as a research map and curation artifact, not as primary evidence.
studyDesign: Research bibliography / curation artifact
modality: Mixed sauna and passive heat literature with Finnish dry-sauna emphasis
finnishDrySaunaFocus: Yes or Likely subset included
murphV1Priority: High
aliases:
  - sauna bibliography 2026
  - sauna research corpus
corpusStats:
  masterRecords: 180
  finnishDrySaunaSubsetRecords: 81
  reviewMetaRecords: 32
  curatedShortlistRecords: 40
  highPriorityRecords: 24
  mediumPriorityRecords: 65
  lowerPriorityRecords: 91
  finnishDrySaunaYesRecords: 36
  finnishDrySaunaYesOrLikelyRecords: 81
  earliestYear: 1978
  latestYear: 2026
  auditCutoff: 2026-04-18
evidenceMap:
  recordTypeCounts:
    reviewMeta: 32
    primaryStudy: 96
    primaryOther: 52
  focusCounts:
    unclear: 54
    no: 45
    likely: 45
    yes: 36
  priorityCounts:
    lower: 91
    medium: 65
    high: 24
  domainCounts:
    cardiovascular: 55
    general-mixed: 36
    safety-physiology: 32
    exercise-recovery: 20
    respiratory-ent: 11
    neuro-mental: 8
    cardiometabolic: 7
    symptoms-musculoskeletal: 6
    mechanistic-biomarkers: 5
  modalityCounts:
    sauna-unspecified-likely-dry: 66
    finnish-dry-sauna: 36
    sauna-likely-dry: 29
    heat-therapy-adjacent: 20
    waon-far-infrared-dry-sauna: 11
    other-unclear: 9
    infrared-sauna: 6
    dry-sauna-exercise-adjunct: 3
  shortlistBucketCounts:
    long-term-finnish-cohort-evidence: 14
    intervention-design-reality-checks: 13
    acute-and-mechanistic: 8
    evidence-backbone: 5
backboneSourceKeys:
  - source_artifact:pmid-16871826
  - source_artifact:pmid-29849692
  - source_artifact:mayo-2018-sauna-review
  - source_artifact:pmid-32814462
  - source_artifact:pmid-38577299
shortlistSourceKeys:
  - source_artifact:pmid-29849692
  - source_artifact:mayo-2018-sauna-review
  - source_artifact:pmid-32814462
  - source_artifact:pmid-38577299
  - source_artifact:pmid-41032138
  - source_artifact:pmid-25705824
  - source_artifact:pmid-29229091
  - source_artifact:pmid-28905164
  - source_artifact:pmid-27932366
  - source_artifact:pmid-28633297
  - source_artifact:pmid-28972808
  - source_artifact:pmid-29897261
  - source_artifact:pmid-30486813
  - source_artifact:pmid-30665914
  - source_artifact:pmid-31372865
  - source_artifact:pmid-35908583
  - source_artifact:pmid-36255556
  - source_artifact:pmid-37029766
  - source_artifact:pmid-38410962
  - source_artifact:pmid-29269746
  - source_artifact:pmid-31126559
  - source_artifact:pmid-31331560
  - source_artifact:pmid-32951736
  - source_artifact:pmid-34622026
  - source_artifact:pmid-36813265
  - source_artifact:doi-10.1152-ajpregu.00012.2025
  - source_artifact:doi-10.1080-23328940.2026.2645467
  - source_artifact:pmid-25432420
  - source_artifact:pmid-31490429
  - source_artifact:pmid-31869820
  - source_artifact:pmid-33211153
  - source_artifact:pmid-34297227
  - source_artifact:pmid-34199101
  - source_artifact:pmid-35710395
  - source_artifact:pmid-35785965
  - source_artifact:pmid-34727008
  - source_artifact:pmid-37650138
  - source_artifact:doi-10.3390-app151910762
  - source_artifact:pmid-40611569
  - source_artifact:pmid-41831305
---

## What this is

This page represents the structured sauna research corpus behind the Finnish dry-sauna experiment. It is a curation artifact, not a primary study.

## Corpus at a glance

- 180 master bibliography records
- 81 records in the Finnish dry-sauna yes/likely subset
- 32 review or meta-analysis records
- 40 papers on the curated source list
- 24 high-priority records for the first dry-sauna experiment
- publication window 1978–2026
- audit cutoff 2026-04-18

## Source groups

- Evidence backbone: 5
- Long-term Finnish cohort evidence: 14
- Acute and mechanistic: 8
- Intervention design / reality checks: 13

## How to use this evidence

Use this page to understand how deep the sauna research base is, which evidence buckets are strongest for protocol design, and why the Finnish dry-sauna experiment separates long-term context from short-term measurable signals.

- The **evidence backbone** papers help define the overall research base and safety framing.
- The **long-term Finnish cohort** papers are rationale and screening context, not 21-day signals.
- The **acute and mechanistic** papers help pick measurable session and near-term signals.
- The **intervention design / reality checks** papers stop the protocol from overclaiming and help define how to standardize timing, hydration, exercise context, and expected latency.

## Important caution

This page is not itself evidence that a sauna protocol works. It is the map used to build a bounded, user-readable protocol from the underlying literature.
