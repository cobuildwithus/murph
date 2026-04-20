---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:dry-sauna/bryan-johnson-blueprint
slug: protocols/dry-sauna/bryan-johnson-blueprint
title: Bryan Johnson Sauna Protocol
summary: External named dry-sauna protocol placeholder. It is intentionally separated from the Murph canonical protocol until exact dose, source, and evidence claims are reviewed.
status: draft
quality: stub
aliases:
  - Bryan Johnson sauna
  - Blueprint sauna
categories:
  - passive-heat
  - external-protocol
relations:
  -
    type: parent_family
    target: experiment_family:dry-sauna
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
lineage:
  relationship: external_named_protocol
  rationale: External named protocol placeholder; replace temporary dose metadata after source review.
attribution:
  ownerType: external
  sourceUrl: https://blueprint.bryanjohnson.com/
  note: Temporary attribution placeholder; verify exact instructions before marking reviewed.
protocol:
  doseSignature: External named dry-sauna protocol placeholder - dose pending review
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 10
    max: 20
  interventionSessionsMinimum: 1
  interventionSessionsTarget: 6
  steps:
    - Verify exact external instructions before using this as a Murph experiment.
testPlans:
  -
    planId: placeholder-rhr-21d
    durationDays: 21
    baselineDays: 7
    interventionDays: 14
    primaryBiomarkerKey: biomarker:resting-heart-rate
safety:
  cautionLevel: moderate
  notes:
    - Inherits general dry-sauna safety until the exact external protocol is reviewed.
---

This page exists to lock the lineage and attribution model. It should not be treated as a reviewed Murph protocol yet.
