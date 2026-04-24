---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1016-j.aehs.2024.05.002"
slug: "sources/creatine-supplementation/doi-10.1016-j.aehs.2024.05.002"
title: "Does one dose of creatine supplementation fit all?"
summary: "Narrative dose-individualization review discussing when loading, maintenance, relative body-mass dosing, bone, and brain dosing may differ across tissues and populations."
status: draft
quality: usable
aliases:
  - "Does one dose of creatine supplementation fit all?"
  - "Candow Ostojic Forbes Antonio 2024 creatine dose review"
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
  kind: "review"
  title: "Does one dose of creatine supplementation fit all?"
  authors: "Candow DG, Ostojic SM, Forbes SC, Antonio J"
  year: 2024
  journal: "Advanced Exercise and Health Science"
  citation: "Candow DG, Ostojic SM, Forbes SC, Antonio J. Does one dose of creatine supplementation fit all? Advanced Exercise and Health Science. 2024;1:99-107. doi:10.1016/j.aehs.2024.05.002."

  doi: "10.1016/j.aehs.2024.05.002"
  url: "https://doi.org/10.1016/j.aehs.2024.05.002"
researchEvidence:
  designKind: narrative_review
  designLabel: "Narrative review of creatine dosing across skeletal muscle, bone, and brain contexts"

  populationLabel: "Mixed creatine-supplementation populations, including healthy adults, athletes, and older adults discussed across included literature"
  durationLabel: "Varies by cited literature; no single intervention duration"
  aggregateRole: primary
  cohortKey: "mixed-review-populations"
protocolEvidence:
  -
    protocolKey: protocol_variant:creatine-supplementation/creatine-monohydrate
    groupId: "dose-individualization-background"
    stance: context_only
    scope: general_guideline
    result: not_efficacy_evidence
    headline: "Creatine dosing may need to vary by tissue target and population rather than assuming one universal dose."
    implication: "Use as background for dose ranges and individualization language, not as a direct Murph protocol efficacy claim."
    caveat: "Narrative review; it does not test a single creatine-monohydrate self-experiment protocol."
    displayPriority: 52
evidenceBucket: "background_guidelines_external"
whyItMatters: "It helps explain why a protocol may mention loading, maintenance, relative dosing, and population-specific caution without making one-size-fits-all claims."
potentialMurphEndpoints:
  - "body weight"
  - "lean mass"
  - "strength output"
  - "bone-health signals"
  - "cognitive or fatigue signals"
protocolTakeaway: "Context-only: loading and maintenance approaches are plausible, but protocol claims should cite direct intervention evidence when available."
murphTakeaway: "Treat dose as a tunable variable. Skeletal-muscle, bone, and brain targets may not respond to the same dose or time window."
studyDesign: "narrative_review"
modality: "supplement"
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **background_guidelines_external**.

**Findings:**
- From `source_artifact:doi-10.1016-j.aehs.2024.05.002`: the review summarizes conventional skeletal-muscle dosing as a loading phase around 20 g/day for up to 7 days, often followed by 3-5 g/day maintenance, while also discussing slower or relative-dose options.
- From `source_artifact:doi-10.1016-j.aehs.2024.05.002`: relative dosing around 0.10-0.14 g/kg/day is discussed as a viable strategy in some populations, especially older adults and bone-focused contexts when paired with exercise.
- From `source_artifact:doi-10.1016-j.aehs.2024.05.002`: brain-creatine targets may require higher acute doses or longer moderate dosing than skeletal-muscle maintenance approaches; this is mechanistic/background rather than direct Murph efficacy evidence.
- The source emphasizes likely response modifiers including baseline tissue creatine, diet, sex, age, activity, fiber morphology, and tissue target.

**Why it matters:** It helps explain why a protocol may mention loading, maintenance, relative dosing, and population-specific caution without making one-size-fits-all claims.

**Potential experiment signals:**
- body weight
- lean mass
- strength output
- bone-health signals
- cognitive or fatigue signals

**Protocol takeaway:** Context-only: loading and maintenance approaches are plausible, but protocol claims should cite direct intervention evidence when available.

**Murph takeaway:** Treat dose as a tunable variable. Skeletal-muscle, bone, and brain targets may not respond to the same dose or time window.

**Limitations and population mismatch:** Narrative review, not a trial; evidence spans different tissues, dosing strategies, and populations; do not use it alone to assert direct protocol effects.

**Claim use:** `context-only`.

---
