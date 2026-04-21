---
schemaVersion: murph.commons.page.v1
entityType: disambiguation
key: disambiguation:sauna-protocol
slug: protocols/sauna-protocol
title: Sauna Protocol
summary: Pick the sauna option that matches what you can actually do: traditional dry sauna, infrared sauna, a simple Finnish-style routine, or the higher-burden Bryan Johnson version.
status: draft
quality: usable
aliases:
  - sauna protocol
options:
  -
    key: experiment_family:dry-sauna
    label: Dry Sauna
    description: Use a hot, low-humidity sauna and track whether heat exposure changes recovery, sleep, or cardiovascular signals.
  -
    key: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
    label: Finnish Dry Sauna
    description: Sit in a traditional dry sauna for short, repeatable sessions and watch recovery, sleep, resting heart rate, or morning blood pressure.
  -
    key: experiment_family:infrared-sauna
    label: Infrared Sauna
    description: Use lower-temperature infrared heat exposure instead of a traditional high-temperature dry sauna.
  -
    key: protocol_variant:dry-sauna/bryan-johnson-blueprint
    label: Bryan Johnson Sauna
    description: Use a very hot, low-humidity dry sauna after workouts and track whether the added heat load is tolerable.
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
---

Use this page when "sauna protocol" could mean more than one heat-exposure option.
