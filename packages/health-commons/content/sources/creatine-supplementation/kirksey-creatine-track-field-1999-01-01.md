---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:kirksey-creatine-track-field-1999-01-01"
slug: "sources/creatine-supplementation/kirksey-creatine-track-field-1999-01-01"
title: "The effects of 6 weeks of creatine monohydrate supplementation on performance measures and body composition in collegiate track and field athletes."
summary: "Six-week randomized trial in collegiate track-and-field athletes; creatine produced sport-specific power and lean-body-mass gains versus placebo, but findings should remain context-only/mixed for the default gym protocol."
status: draft
quality: usable
aliases:
  - "Kirksey 1999 creatine track and field athletes"
  - "Creatine monohydrate collegiate track and field athletes"
categories:
  - creatine-supplementation
relations:
  -
    type: related_protocol
    target: "protocol_variant:creatine-supplementation/creatine-monohydrate"
  -
    type: parent_family
    target: "experiment_family:creatine-supplementation"
source:
  kind: "journal_article"
  title: "The effects of 6 weeks of creatine monohydrate supplementation on performance measures and body composition in collegiate track and field athletes."
  authors: "Brett Kirksey; Michael H. Stone; Beverly J. Warren; Robert L. Johnson; Meg Stone; G. Gregory Haff; F. E. Williams; Chris Proulx"
  year: 1999
  journal: "Journal of Strength and Conditioning Research"
  citation: "Kirksey B, Stone MH, Warren BJ, Johnson RL, Stone M, Haff GG, Williams FE, Proulx C. The effects of 6 weeks of creatine monohydrate supplementation on performance measures and body composition in collegiate track and field athletes. J Strength Cond Res. 1999;13(2):148-156."

  url: "https://journals.lww.com/nsca-jscr/abstract/1999/05000/the_effects_of_6_weeks_of_creatine_monohydrate.9.aspx"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "Randomized placebo-controlled sport-training trial"
  participantCount: 36

  populationLabel: "Collegiate track-and-field athletes, including men and women"
  durationLabel: "6 weeks"
  aggregateRole: primary
  cohortKey: "kirksey-1999-track-field"
evidenceBucket: "strength_hypertrophy_trials"
whyItMatters: "Preserves a primary field-sport/power trial that could otherwise be over-generalized into a generic gym-performance claim."
potentialMurphEndpoints:
  - "countermovement vertical jump"
  - "cycle peak power"
  - "cycle average power"
  - "cycle total work"
  - "lean body mass"
protocolTakeaway: "Keep as context-only/mixed: creatine may support power and lean-body-mass signals in collegiate track-and-field training, but these results are not a universal resistance-training claim."
murphTakeaway: "Sport, event type, and training block matter; track power and body-composition outcomes separately from generic strength outcomes."
studyDesign: "Randomized placebo-controlled sport-training trial"
modality: "Creatine monohydrate during collegiate track-and-field preseason training"
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **strength_hypertrophy_trials**.

**Findings:** `source_artifact:kirksey-creatine-track-field-1999-01-01` — Collegiate track-and-field athletes received 0.30 g/kg/day creatine monohydrate or placebo for six weeks during preseason sprint and weight-training work. Reported percent-gain advantages favored creatine for countermovement jump height/power, several cycle-ergometer power/work endpoints, and lean body mass. The source was flagged for mixed/null-sensitive use because endpoints are sport-specific and not all tested outcomes were extracted as positive.

**Why it matters:** Preserves a primary field-sport/power trial that could otherwise be over-generalized into a generic gym-performance claim.

**Potential experiment signals:** countermovement jump height; countermovement jump power index; cycle peak power; cycle average power; cycle total work; cycle initial rate of power production; lean body mass.

**Protocol takeaway:** Keep as context-only/mixed: creatine may support power and lean-body-mass signals in collegiate track-and-field training, but these results are not a universal resistance-training claim.

**Limitations and extraction boundary:** Collegiate athlete sample with event-specific training. No PMID or DOI was identified in the canonical ledger. Extracted record did not enumerate all null endpoints or adverse events. Use as sport-specific context rather than broad gym-protocol support.

**Claim use:** `context-only`.
