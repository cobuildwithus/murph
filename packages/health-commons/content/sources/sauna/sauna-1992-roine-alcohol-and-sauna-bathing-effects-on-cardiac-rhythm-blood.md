---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sauna-1992-roine-alcohol-and-sauna-bathing-effects-on-cardiac-rhythm-blood
slug: sources/sauna/sauna-1992-roine-alcohol-and-sauna-bathing-effects-on-cardiac-rhythm-blood
title: "Alcohol and sauna bathing: Effects on cardiac rhythm, blood pressure, and serum electrolyte and cortisol concentrations"
summary: "This crossover study tested sauna exposure with alcohol in healthy adults. The main finding is that alcohol can change the cardiac, blood-pressure, electrolyte, and cortisol context of sauna bathing. For Murph, it supports logging alcohol and avoiding alcohol as a confounder during the experiment."
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
  title: "Alcohol and sauna bathing: Effects on cardiac rhythm, blood pressure, and serum electrolyte and cortisol concentrations"
  authors: "Roine R, Luurila OJ, Suokas A et al"
  year: 1992
  journal: "J Intern Med"
  citation: "Roine R, Luurila OJ, Suokas A et al. Alcohol and sauna bathing: Effects on cardiac rhythm, blood pressure, and serum electrolyte and cortisol concentrations. J Intern Med 1992;231:333-338."
researchEvidence:
  designKind: "crossover_trial"
  designLabel: "Alcohol/sauna crossover study"
  participantCount: 10
  participantCountKind: "reported"
  populationLabel: "Healthy adult volunteers"
  durationLabel: "Acute alcohol plus sauna exposure"
  aggregateRole: "primary"
  cohortKey: "roine-1992-alcohol-sauna-volunteers"
evidenceBucket: Finnish dry-sauna corpus
whyItMatters: "Expands the audited Finnish dry-sauna evidence corpus with a cardiovascular record marked medium priority for Murph v1 interpretation."
potentialMurphEndpoints:
  - blood pressure context
  - resting heart rate context
protocolTakeaway: "Use as cardiovascular context around heat exposure, not as a guaranteed 21-day result-card endpoint."
murphTakeaway: "This source supports logging alcohol and avoiding alcohol as a confounder during the experiment."
studyDesign: "Primary study / unclear"
modality: "Sauna (likely dry)"
finnishDrySaunaFocus: "Likely"
murphV1Priority: "Medium"
sourceUrlCurationNote: Workbook source URL points to a bibliography or review backbone rather than a direct article landing page, so the public source link is intentionally omitted from the app card.
---

This source is part of Murph's audited Finnish dry-sauna yes/likely corpus.

**Findings:** This crossover study tested sauna exposure with alcohol in healthy adults. The main finding is that alcohol can change the cardiac, blood-pressure, electrolyte, and cortisol context of sauna bathing.

**Why it matters:** Expands the audited Finnish dry-sauna evidence corpus with a cardiovascular record marked medium priority for Murph v1 interpretation.

**Potential Murph endpoints/context:** blood pressure context, resting heart rate context

**Protocol takeaway:** Use as cardiovascular context around heat exposure, not as a guaranteed 21-day result-card endpoint.

The workbook linked this record through a review or bibliography backbone rather than a direct article page. Keep it in the corpus, but do not show a potentially misleading outbound source link in the product UI.
