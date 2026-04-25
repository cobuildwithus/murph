---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sauna-2014-gryka-the-effect-of-sauna-bathing-on-lipid-profile-in-young-phys
slug: sources/sauna/sauna-2014-gryka-the-effect-of-sauna-bathing-on-lipid-profile-in-young-phys
title: "The effect of sauna bathing on lipid profile in young, physically active, male subjects"
summary: "This single-arm study tested repeated sauna bathing in young physically active men and lipid markers. The main finding is that lipid and cardiometabolic markers were explored over repeated sessions, but without a strong control design. For Murph, it is secondary cardiometabolic context rather than an MVP wearable endpoint."
status: draft
quality: usable
categories:
  - sauna
  - study
  - cardiometabolic
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: parent_family
    target: experiment_family:dry-sauna
source:
  kind: journal_article
  title: "The effect of sauna bathing on lipid profile in young, physically active, male subjects"
  authors: "D. Gryka, W. Pilch, M. Szarek, Z. Szygula, and Ł. Tota"
  year: 2014
  journal: "International Journal of Occupational Medicine and Environmental Health"
  citation: "D. Gryka, W. Pilch, M. Szarek, Z. Szygula, and Ł. Tota, “The effect of sauna bathing on lipid profile in young, physically active, male subjects,” International Journal of Occupational Medicine and Environmental Health, vol. 27, no. 4, pp. 608–618, 2014."
researchEvidence:
  designKind: "single_arm_trial"
  designLabel: "Young-men lipid intervention"
  participantCount: 16
  participantCountKind: "approximate"
  populationLabel: "Young physically active men"
  durationLabel: "Repeated sauna sessions"
  aggregateRole: "primary"
  cohortKey: "gryka-2014-young-active-men"
evidenceBucket: Finnish dry-sauna corpus
whyItMatters: "Expands the audited Finnish dry-sauna evidence corpus with a cardiometabolic record marked medium priority for Murph v1 interpretation."
potentialMurphEndpoints:
  - blood pressure context
  - resting heart rate context
  - safety screening
protocolTakeaway: "Use as cardiovascular context around heat exposure, not as a guaranteed 21-day result-card endpoint."
murphTakeaway: "This source is secondary cardiometabolic context rather than an MVP wearable endpoint."
studyDesign: "Experimental physiology"
modality: "Sauna (likely dry)"
finnishDrySaunaFocus: "Likely"
murphV1Priority: "Medium"
sourceUrlCurationNote: Workbook source URL points to a bibliography or review backbone rather than a direct article landing page, so the public source link is intentionally omitted from the app card.
---

This source is part of Murph's audited Finnish dry-sauna yes/likely corpus.

**Findings:** This single-arm study tested repeated sauna bathing in young physically active men and lipid markers. The main finding is that lipid and cardiometabolic markers were explored over repeated sessions, but without a strong control design.

**Why it matters:** Expands the audited Finnish dry-sauna evidence corpus with a cardiometabolic record marked medium priority for Murph v1 interpretation.

**Potential Murph endpoints/context:** blood pressure context, resting heart rate context, safety screening

**Protocol takeaway:** Use as cardiovascular context around heat exposure, not as a guaranteed 21-day result-card endpoint.

The workbook linked this record through a review or bibliography backbone rather than a direct article page. Keep it in the corpus, but do not show a potentially misleading outbound source link in the product UI.
