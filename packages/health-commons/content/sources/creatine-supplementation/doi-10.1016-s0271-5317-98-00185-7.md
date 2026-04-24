---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-s0271-5317-98-00185-7
slug: sources/creatine-supplementation/doi-10.1016-s0271-5317-98-00185-7
title: "Effects of 8 weeks of creatine supplementation on exercise performance and fat-free weight in football players during training."
summary: "Football-player training trial comparing carbohydrate, creatine plus low carbohydrate, and creatine plus high carbohydrate formulations over 8 weeks."
status: draft
quality: usable
aliases:
  - "Stout 1999 creatine carbohydrate football players"
  - "Nutrition Research creatine football players"
categories:
  - creatine-supplementation
relations:
  -
    type: related_protocol
    target: protocol_variant:creatine-supplementation/creatine-monohydrate
  -
    type: parent_family
    target: experiment_family:creatine-supplementation
source:
  kind: journal_article
  title: "Effects of 8 weeks of creatine supplementation on exercise performance and fat-free weight in football players during training."
  authors: "Stout JR, Eckerson J, Noonan D, Moore G, Cullen D"
  year: 1999
  journal: "Nutrition Research"
  citation: "Stout JR, Eckerson J, Noonan D, Moore G, Cullen D. Effects of 8 weeks of creatine supplementation on exercise performance and fat-free weight in football players during training. Nutrition Research. 1999;19(2):217-225. doi:10.1016/S0271-5317(98)00185-7."

  doi: "10.1016/S0271-5317(98)00185-7"
  url: "https://doi.org/10.1016/S0271-5317(98)00185-7"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "Football-player resistance/speed-training supplementation trial"
  participantCount: 24

  populationLabel: "College football players during training"
  durationLabel: "8 weeks after initial loading-style dosing"
  aggregateRole: primary
  cohortKey: "stout-1999-football-creatine-carbohydrate"
protocolEvidence:
  -
    protocolKey: protocol_variant:creatine-supplementation/creatine-monohydrate
    groupId: "adjacent-carbohydrate-formulation"
    stance: context_only
    scope: adjacent_variant
    result: mixed
    headline: "A creatine-plus-carbohydrate formulation improved some football training outcomes versus carbohydrate, but the design is formulation-adjacent."
    implication: "Context for carbohydrate/creatine formulations during training, not a clean timing or monohydrate-only claim."
    caveat: "Adjacent variant with football players, formulation arms, and sport-specific training; no PMID in canonical ledger."
    displayPriority: 45
evidenceBucket: "timing_coingestion"
whyItMatters: "It is a boundary source for creatine-carbohydrate formulations that could otherwise be over-read as direct timing evidence."
potentialMurphEndpoints:
  - "fat-free weight"
  - "bench press"
  - "vertical jump"
  - "sprint"
  - "training context"
protocolTakeaway: "Do not use this as direct support for creatine timing; it is context for carbohydrate-containing formulations in football training."
murphTakeaway: "Adjacent only; useful for source recall and formulation boundaries."
studyDesign: "rct"
modality: "creatine-containing carbohydrate formulations during football training"
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: paywalled
---

This source is included for **timing_coingestion**.

**Findings:** [source_artifact:doi-10.1016-s0271-5317-98-00185-7] reported sport-performance and fat-free-weight changes in college football players using creatine/carbohydrate formulations during training. Because the intervention was a formulation comparison rather than creatine monohydrate timing, the claim boundary is context-only.

**Why it matters:** It helps prevent adjacent creatine-carbohydrate formulation evidence from being promoted into direct protocol claims.

**Potential experiment signals:** Training outcomes, fat-free weight, sprint/jump/bench performance.

**Protocol takeaway:** Do not use this as direct support for creatine timing; it is context for carbohydrate-containing formulations in football training.

**Limitations / boundary notes:** Formulation arms; college football population; no clean timing contrast; not monohydrate-only protocol evidence.

**Claim use:** `context-only`.
