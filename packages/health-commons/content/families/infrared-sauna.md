---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:infrared-sauna
slug: families/infrared-sauna
title: Infrared Sauna
summary: Infrared heat exposure protocols. Kept separate from dry sauna because heat source, temperature, session shape, and evidence base can differ.
status: draft
quality: usable
aliases:
  - infrared heat therapy
categories:
  - passive-heat
  - sauna
familyKind: modality
parentFamilyKey: experiment_family:sauna
relations:

  -
    type: parent_family
    target: experiment_family:sauna
  -
    type: cites
    target: source_artifact:doi-10.1152-ajpregu.00012.2025
  -
    type: cites
    target: source_artifact:pmid-38577299
---

Infrared sauna belongs as its own experiment family, not as a variant of the Finnish dry-sauna protocol.

The modality split matters because infrared heat exposure can differ in heat source, temperature, session length, safety framing, and evidence base. Infrared pages can share broad passive-heat context without reusing the Finnish dry-sauna dose or expected-result language.
