---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:linkedin-bryan-johnson-core-temp-2026-04-16
slug: sources/sauna/linkedin-bryan-johnson-core-temp-2026-04-16
title: LinkedIn post - Bryan Johnson core body temperature sauna update
summary: Readable mirror of the April 2026 core-temperature update saying 20-minute 200 F sessions likely missed the 102.4 F / 39 C threshold and that it took about 31 minutes.
status: draft
quality: usable
aliases:
  - linkedin bryan johnson core body temp sauna april 2026
categories:
  - source
  - sauna
  - linkedin
relations:
  -
    type: mirror_of
    target: source_artifact:x-bryan-johnson-core-temp-2026-04-16
source:
  kind: web_page
  title: Most people might miss the biggest benefit of sauna
  authors: Bryan Johnson
  year: 2026
  url: https://www.linkedin.com/posts/bryanrjohnson_most-people-might-miss-the-biggest-benefit-activity-7451007192889024512-UFlX
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
    groupId: core-temperature-dose-variant
    stance: mixed
    scope: measurement_context
    result: not_efficacy_evidence
    endpointKeys: []
    headline: "Readable April 16 mirror says Johnson needed about 31 minutes to cross his 102.4 F / 39 C threshold."
    implication: "Supports treating duration and core-temperature dose as separate concepts on the protocol page."
    caveat: "Readable mirror of a single-person update, not a protocol trial."
    displayPriority: 20
artifacts:
  -
    artifactId: art_linkedin_bryan_johnson_core_temp_2026_04_16_html_snapshot
    kind: html
    storage: cloudflare-r2
    objectKey: commons/sources/sauna/linkedin-bryan-johnson-core-temp-2026-04-16.html
    localPath: source-artifacts/sauna/linkedin-bryan-johnson-core-temp-2026-04-16.html
    sourceUrl: https://www.linkedin.com/posts/bryanrjohnson_most-people-might-miss-the-biggest-benefit-activity-7451007192889024512-UFlX
    rightsStatus: unknown
    redistributable: false
    accessNotes: Optional mirror snapshot for provenance; review rights before storing or redistributing.
---

This LinkedIn post is a readable mirror for the April 2026 core-temperature update. It says many 20-minute 200 F sauna sessions may miss the 102.4 F / 39 C threshold. Johnson reports needing about 31 minutes to reach that mark in his own test. The finding is useful for dose interpretation, but remains a single-person report.
