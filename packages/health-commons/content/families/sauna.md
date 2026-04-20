---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:sauna
slug: families/sauna
title: Sauna / Passive Heat
summary: The broad passive-heat intervention family. User-facing experiment families such as dry sauna and infrared sauna are kept separate below this parent.
status: draft
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
---

Sauna is the broad passive-heat family. It should not collapse dry sauna, infrared sauna, steam room, hot bath, and other heat modalities into one recipe.

Murph should use this parent page for education and search, while protocol cards should usually attach to a more intuitive user-facing family such as Dry Sauna or Infrared Sauna.
