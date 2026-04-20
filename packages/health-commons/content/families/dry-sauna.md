---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:dry-sauna
slug: families/dry-sauna
title: Dry Sauna
summary: Traditional high-temperature dry-sauna exposure, including Finnish dry sauna protocols, separated from infrared sauna and steam room protocols.
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
    target: source_artifact:mayo-2018-sauna-review
  -
    type: cites
    target: source_artifact:pmid-38577299
---

Dry sauna is the user-facing family for high-temperature, low-humidity sauna exposure. Murph's first canonical protocol is specifically a Finnish dry-sauna version of this family.

This page deliberately separates dry sauna from infrared sauna. The distinction matters because heat source, temperature, humidity, session length, and evidence base can differ enough that the protocols should not be merged.
