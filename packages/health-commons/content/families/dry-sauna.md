---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:dry-sauna
slug: families/dry-sauna
title: Dry Sauna
summary: Traditional high-temperature dry-sauna exposure, including Finnish dry sauna protocols, separated from infrared sauna and steam-room protocols.
status: field-testing
quality: usable
aliases:
  - Finnish sauna
  - Finnish dry sauna
  - traditional dry sauna
categories:
  - passive-heat
  - sauna
  - recovery
familyKind: modality
parentFamilyKey: experiment_family:sauna
canonicalModality: finnish_dry_sauna
relations:
  -
    type: parent_family
    target: experiment_family:sauna
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: cites
    target: source_artifact:sauna-bibliography-2026-04-18
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
    target: source_artifact:pmid-38577299
  -
    type: cites
    target: source_artifact:doi-10.1152-ajpregu.00012.2025
researchCoverage:
  bibliographyKey: source_artifact:sauna-bibliography-2026-04-18
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
  shortlistBucketCounts:
    long-term-finnish-cohort-evidence: 14
    intervention-design-reality-checks: 13
    acute-and-mechanistic: 8
    evidence-backbone: 5
---

Dry sauna is the family for high-temperature, low-humidity sauna exposure. The first practical version here is a **Finnish dry-sauna** experiment.

Dry sauna stays separate from infrared sauna for three reasons:

1. **Dose is different.** Temperature, humidity, and session duration differ enough that instructions should not silently transfer.
2. **Evidence is different.** Much of the strongest supporting literature is Finnish dry-sauna or likely-dry-sauna work, not generic passive-heat evidence.
3. **Interpretation is different.** Standalone dry sauna, post-exercise dry sauna, and other heat modalities can produce different physiological stories.

The dry-sauna research base is no longer just a few review papers. The corpus includes backbone reviews, long-term Finnish cohort papers, acute and mechanistic papers, and intervention-design or reality-check papers.
