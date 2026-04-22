---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:bryan-johnson-morning-routine-2026-04-08
slug: sources/sauna/bryan-johnson-morning-routine-2026-04-08
title: Bryan Johnson - My Morning Routine 2026
summary: Blueprint morning-routine page confirming a daily 20-minute 200 F sauna, post-sauna ear temperature, groin ice packs, a wool hat, and a recent face-and-neck cooling experiment.
status: draft
quality: usable
aliases:
  - bryan johnson morning routine 2026 sauna
categories:
  - source
  - sauna
  - blueprint
source:
  kind: web_page
  title: My Morning Routine 2026
  authors: Bryan Johnson
  year: 2026
  url: https://blueprint.bryanjohnson.com/blogs/news/morning-routine
researchEvidence:
  designKind: single_person_report
  designLabel: Single-person report
  participantCount: 1
  participantCountKind: reported
  populationLabel: Bryan Johnson
  aggregateRole: duplicate
  cohortKey: bryan-johnson-sauna-self-report
  notes:
    - Same single-person source family as the Bryan Johnson sauna protocol report.
protocolEvidence:
  -
    protocolKey: protocol_variant:dry-sauna/bryan-johnson-blueprint
    groupId: source-routine-spec
    stance: supports
    scope: direct_protocol
    result: not_efficacy_evidence
    endpointKeys:
      - biomarker:resting-heart-rate
      - biomarker:hrv-rmssd
    headline: "Morning-routine page corroborates the 20-minute 200 F daily sauna and adds routine-level tactics."
    implication: "Supports the page's exact timing, groin-cooling, head-protection, and tracking details for the Blueprint routine."
    caveat: "It repeats the same single-person source family and does not add independent outcome evidence."
    displayPriority: 20
artifacts:
  -
    artifactId: art_bryan_johnson_morning_routine_2026_04_08_html_snapshot
    kind: html
    storage: cloudflare-r2
    objectKey: commons/sources/sauna/bryan-johnson-morning-routine-2026-04-08.html
    localPath: source-artifacts/sauna/bryan-johnson-morning-routine-2026-04-08.html
    sourceUrl: https://blueprint.bryanjohnson.com/blogs/news/morning-routine
    rightsStatus: unknown
    redistributable: false
    accessNotes: Optional HTML snapshot for provenance; review rights before storing or redistributing.
---

This morning-routine page corroborates that sauna is part of Johnson's daily routine. It repeats the 20-minute 200 F exposure and adds details such as ear-temperature checks, groin ice packs, a wool hat, and face or neck cooling experiments. It helps distinguish the routine he reports following from the safer beginner dose. It does not add population evidence.
