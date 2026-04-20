---
schemaVersion: murph.commons.page.v1
entityType: disambiguation
key: disambiguation:sauna-protocol
slug: protocols/sauna-protocol
title: Sauna Protocol
summary: Disambiguation page for sauna protocol searches that could mean dry sauna, infrared sauna, Murph's Finnish dry-sauna experiment, or Bryan Johnson's source-attributed routine.
status: draft
quality: usable
aliases:
  - sauna protocol
options:
  -
    key: experiment_family:dry-sauna
    label: Dry Sauna
    description: User-facing family for traditional high-temperature dry-sauna protocols, including Finnish dry sauna.
  -
    key: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
    label: Murph Finnish Dry Sauna
    description: Canonical Murph field-test protocol for dry sauna.
  -
    key: experiment_family:infrared-sauna
    label: Infrared Sauna
    description: Separate sauna family for infrared heat exposure.
  -
    key: protocol_variant:dry-sauna/bryan-johnson-blueprint
    label: Bryan Johnson Blueprint Sauna
    description: External named daily dry-sauna routine; 20 minutes at 200 F with groin cooling, plus a later high-burden core-temperature-threshold experiment.
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
---

Use this page when a user says "sauna protocol" and the system needs to choose among multiple sauna families or named recipes.
