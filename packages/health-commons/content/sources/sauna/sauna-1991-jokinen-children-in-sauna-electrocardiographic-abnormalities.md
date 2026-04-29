---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sauna-1991-jokinen-children-in-sauna-electrocardiographic-abnormalities
slug: sources/sauna/sauna-1991-jokinen-children-in-sauna-electrocardiographic-abnormalities
title: "Children in sauna: Electrocardiographic abnormalities"
summary: "This pediatric physiology study examined ECG changes around sauna exposure. The main finding is that acute sauna can interact with cardiac electrical monitoring in children, making safety context important. For Murph, it reinforces conservative screening and symptom stop rules."
status: draft
quality: usable
categories:
  - sauna
  - study
  - safety-physiology
relations:

  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: parent_family
    target: experiment_family:dry-sauna
source:
  kind: journal_article
  title: "Children in sauna: Electrocardiographic abnormalities"
  authors: "Jokinen E, Välimäki I"
  year: 1991
  journal: "Acta Paediatr Scand"
  citation: "Jokinen E, Välimäki I. Children in sauna: Electrocardiographic abnormalities. Acta Paediatr Scand 1991;80:370-374."
researchEvidence:
  designKind: "acute_mechanistic"
  designLabel: "Pediatric ECG physiology study"
  participantCount: 25
  participantCountKind: "approximate"
  populationLabel: "Children"
  durationLabel: "Acute sauna exposure"
  aggregateRole: "primary"
  aggregationNote: "Approximate count from older pediatric physiology metadata; deduped with companion cardiovascular paper."
  cohortKey: "jokinen-children-sauna-cohort"
evidenceBucket: Finnish dry-sauna corpus
whyItMatters: "Expands the audited Finnish dry-sauna evidence corpus with a safety / physiology record marked lower priority for Murph v1 interpretation."
potentialMurphEndpoints:
  - safety screening
  - session tolerance
protocolTakeaway: "Use for safety screening and session-context interpretation rather than efficacy claims."
murphTakeaway: "This source reinforces conservative screening and symptom stop rules."
studyDesign: "Primary study / unclear"
modality: "Sauna (unspecified / likely dry)"
finnishDrySaunaFocus: "Likely"
murphV1Priority: "Lower"
sourceUrlCurationNote: Workbook source URL points to a bibliography or review backbone rather than a direct article landing page, so the public source link is intentionally omitted from the app card.
---

This source is part of Murph's audited Finnish dry-sauna yes/likely corpus.

**Findings:** This pediatric physiology study examined ECG changes around sauna exposure. The main finding is that acute sauna can interact with cardiac electrical monitoring in children, making safety context important.

**Why it matters:** Expands the audited Finnish dry-sauna evidence corpus with a safety / physiology record marked lower priority for Murph v1 interpretation.

**Potential Murph endpoints/context:** safety screening, session tolerance

**Protocol takeaway:** Use for safety screening and session-context interpretation rather than efficacy claims.

The workbook linked this record through a review or bibliography backbone rather than a direct article page. Keep it in the corpus, but do not show a potentially misleading outbound source link in the product UI.
