---
schemaVersion: murph.commons.page.v1
entityType: disambiguation
key: disambiguation:sauna-protocol
slug: protocols/sauna-protocol
title: Sauna Protocol
summary: A chooser for sauna searches that could mean dry sauna, infrared sauna, a simple Finnish dry-sauna experiment, or a higher-burden routine attributed to Bryan Johnson.
status: draft
quality: usable
aliases:
  - sauna protocol
options:
  -
    key: experiment_family:dry-sauna
    label: Dry Sauna
    description: Traditional high-temperature dry-sauna protocols, including Finnish dry sauna.
  -
    key: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
    label: Finnish Dry Sauna
    description: A simple 3-times-a-week Finnish dry-sauna experiment for comparing baseline and intervention weeks.
  -
    key: experiment_family:infrared-sauna
    label: Infrared Sauna
    description: A separate sauna family for lower-temperature infrared heat exposure.
  -
    key: protocol_variant:dry-sauna/bryan-johnson-blueprint
    label: Bryan Johnson Sauna
    description: A higher-burden daily dry-sauna routine attributed to Bryan Johnson, including special cooling tactics and later core-temperature-threshold updates.
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
---

Use this chooser when “sauna protocol” could mean more than one heat-exposure experiment.
