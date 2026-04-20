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
---

Sauna is the broad passive-heat family. It should not collapse dry sauna, infrared sauna, steam room, hot-water immersion, and other heat modalities into one recipe.

Murph's current sauna research base is large enough to justify separate public pages:

- 180 records in the master bibliography,
- 81 records in the Finnish dry-sauna yes/likely subset,
- 40 curated shortlist papers,
- and distinct evidence buckets for long-term cohorts, acute physiology, and intervention design.

The parent sauna page is useful for education and search. Actual protocol cards should usually attach to a clearer user-facing family such as **Dry Sauna** or **Infrared Sauna**.
