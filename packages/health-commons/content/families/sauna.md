---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:sauna
slug: families/sauna
title: Sauna / Passive Heat
summary: The broad passive-heat intervention family. User-facing families such as dry sauna and infrared sauna stay separate beneath this parent.
status: field-testing
quality: usable
aliases:
  - sauna
  - passive heat
  - heat exposure
categories:
  - passive-heat
  - recovery
familyKind: intervention
relations:

  -
    type: child_family
    target: experiment_family:dry-sauna
  -
    type: child_family
    target: experiment_family:infrared-sauna
  -
    type: cites
    target: source_artifact:sauna-bibliography-2026-04-18
  -
    type: cites
    target: source_artifact:pmid-16871826
  -
    type: cites
    target: source_artifact:pmid-38577299
  -
    type: cites
    target: source_artifact:pmid-41049507
  -
    type: cites
    target: source_artifact:pmid-39762944
  -
    type: cites
    target: source_artifact:pmid-34363927
  -
    type: cites
    target: source_artifact:pmid-22505948
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
  supplementalReview:
    reviewedAt: 2026-04-21
    note: Added broad passive-heating, post-exercise heat, healthspan-synthesis, and sweat-toxicant caveat records at the parent family level so modality-specific pages do not overclaim from adjacent heat literature.
    sourceKeys:
      - source_artifact:pmid-41049507
      - source_artifact:pmid-39762944
      - source_artifact:pmid-34363927
      - source_artifact:pmid-22505948
---

Sauna is the broad passive-heat family. It should not collapse dry sauna, infrared sauna, steam room, hot-water immersion, and other heat modalities into one recipe.

The sauna research base is large enough to keep the main heat modalities separate. A 2026-04-21 supplemental pass added broad passive-heating and sweat-toxicant caveat records here, while dry-sauna-specific fertility, thermal-dose, and acute vascular records live on the Dry Sauna family.

Separate pages matter because passive-heat studies are not interchangeable:

- 180 records in the master bibliography,
- 81 records in the Finnish dry-sauna yes/likely subset,
- 40 curated source papers in the original 2026-04-18 shortlist,
- and distinct evidence buckets for long-term cohorts, acute physiology, and intervention design.

Use this parent page for broad education and search. Protocol cards should attach to clearer families such as **Dry Sauna** or **Infrared Sauna**.
