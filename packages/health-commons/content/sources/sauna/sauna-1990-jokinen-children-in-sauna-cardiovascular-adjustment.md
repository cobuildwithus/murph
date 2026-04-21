---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sauna-1990-jokinen-children-in-sauna-cardiovascular-adjustment
slug: sources/sauna/sauna-1990-jokinen-children-in-sauna-cardiovascular-adjustment
title: "Children in sauna: Cardiovascular adjustment"
summary: "This pediatric physiology study measured cardiovascular adjustment during acute sauna exposure. The main finding is that children can show measurable heart-rate and blood-pressure responses to sauna heat. For Murph, it supports age-sensitive safety cautions rather than adult protocol claims."
status: draft
quality: usable
categories:
  - sauna
  - study
  - cardiovascular
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: parent_family
    target: experiment_family:dry-sauna
source:
  kind: journal_article
  title: "Children in sauna: Cardiovascular adjustment"
  authors: "Jokinen E, Välimäki I, Antila K, Seppänen A, Tuominen J"
  year: 1990
  journal: "Pediatrics"
  citation: "Jokinen E, Välimäki I, Antila K, Seppänen A, Tuominen J. Children in sauna: Cardiovascular adjustment. Pediatrics 1990;86:282-288."
researchEvidence:
  designKind: "acute_mechanistic"
  designLabel: "Pediatric physiology study"
  participantCount: 25
  participantCountKind: "approximate"
  populationLabel: "Children"
  durationLabel: "Acute sauna exposure"
  aggregateRole: "primary"
  aggregationNote: "Approximate count from older pediatric physiology metadata; deduped with companion ECG paper."
  cohortKey: "jokinen-children-sauna-cohort"
evidenceBucket: Finnish dry-sauna corpus
whyItMatters: "Expands the audited Finnish dry-sauna evidence corpus with a cardiovascular record marked medium priority for Murph v1 interpretation."
potentialMurphEndpoints:
  - blood pressure context
  - resting heart rate context
protocolTakeaway: "Use as cardiovascular context around heat exposure, not as a guaranteed 21-day result-card endpoint."
murphTakeaway: "This source supports age-sensitive safety cautions rather than adult protocol claims."
studyDesign: "Primary study / unclear"
modality: "Sauna (unspecified / likely dry)"
finnishDrySaunaFocus: "Likely"
murphV1Priority: "Medium"
sourceUrlCurationNote: Workbook source URL points to a bibliography or review backbone rather than a direct article landing page, so the public source link is intentionally omitted from the app card.
---

This source is part of Murph's audited Finnish dry-sauna yes/likely corpus.

**Findings:** This pediatric physiology study measured cardiovascular adjustment during acute sauna exposure. The main finding is that children can show measurable heart-rate and blood-pressure responses to sauna heat.

**Why it matters:** Expands the audited Finnish dry-sauna evidence corpus with a cardiovascular record marked medium priority for Murph v1 interpretation.

**Potential Murph endpoints/context:** blood pressure context, resting heart rate context

**Protocol takeaway:** Use as cardiovascular context around heat exposure, not as a guaranteed 21-day result-card endpoint.

The workbook linked this record through a review or bibliography backbone rather than a direct article page. Keep it in the corpus, but do not show a potentially misleading outbound source link in the product UI.
