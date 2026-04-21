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
  -
    type: cites
    target: source_artifact:pmid-23411620
  -
    type: cites
    target: source_artifact:pmid-9972494
  -
    type: cites
    target: source_artifact:doi-10.1155-2014-106049
  -
    type: cites
    target: source_artifact:pmid-38344040
  -
    type: cites
    target: source_artifact:pmid-32615263
  -
    type: cites
    target: source_artifact:pmid-11874249
  -
    type: cites
    target: source_artifact:pmid-34363927
  -
    type: cites
    target: source_artifact:pmid-41049507
  -
    type: cites
    target: source_artifact:pmid-31293098
  -
    type: cites
    target: source_artifact:pmid-24899780
  -
    type: cites
    target: source_artifact:pmid-3218894
  -
    type: cites
    target: source_artifact:pmid-3218897
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
  supplementalReview:
    reviewedAt: 2026-04-21
    note: Added fertility, acute thermal-dose, extreme-heat, acute vascular, passive-heat review, dry-vs-steam modality, and classic thermoregulation or fluid-balance sources to the dry-sauna family while leaving source-attributed external protocols to their own posts.
    sourceKeys:
      - source_artifact:pmid-23411620
      - source_artifact:pmid-9972494
      - source_artifact:doi-10.1155-2014-106049
      - source_artifact:pmid-38344040
      - source_artifact:pmid-32615263
      - source_artifact:pmid-11874249
      - source_artifact:pmid-34363927
      - source_artifact:pmid-41049507
      - source_artifact:pmid-31293098
      - source_artifact:pmid-24899780
      - source_artifact:pmid-3218894
      - source_artifact:pmid-3218897
---

Dry sauna is the family for high-temperature, low-humidity sauna exposure. The first practical version here is a **Finnish dry-sauna** experiment.

Dry sauna stays separate from infrared sauna for three reasons:

1. **Dose is different.** Temperature, humidity, and session duration differ enough that instructions should not silently transfer.
2. **Evidence is different.** Much of the strongest supporting literature is Finnish dry-sauna or likely-dry-sauna work, not generic passive-heat evidence.
3. **Interpretation is different.** Standalone dry sauna, post-exercise dry sauna, and other heat modalities can produce different physiological stories.

The dry-sauna research base is no longer just a few review papers. The corpus includes backbone reviews, long-term Finnish cohort papers, acute and mechanistic papers, intervention-design or reality-check papers, and a 2026-04-21 supplemental pass that added dry-vs-steam, acute vascular, thermoregulation, and fluid-balance context without collapsing everything into the Bryan Johnson routine.

A 2026-04-21 supplemental pass also kept the broader fertility, high-heat safety, and physiology evidence on the dry-sauna family instead of attaching it to the Bryan Johnson protocol page. That keeps Bryan Johnson's page focused on Bryan/Blueprint posts while the dry-sauna family owns the broader safety and physiology evidence.
