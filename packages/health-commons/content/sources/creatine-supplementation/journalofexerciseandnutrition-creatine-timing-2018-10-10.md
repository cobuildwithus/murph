---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:journalofexerciseandnutrition-creatine-timing-2018-10-10"
slug: "sources/creatine-supplementation/journalofexerciseandnutrition-creatine-timing-2018-10-10"
title: "Timing of Creatine Supplementation and Resistance Training: A Brief Review"
summary: "Brief open-access review and small meta-analysis of creatine timing around resistance training; post-exercise timing favored lean tissue mass across three studies, but strength did not differ and evidence was underpowered."
status: draft
quality: usable
aliases:
  - "Timing of Creatine Supplementation and Resistance Training"
  - "Forbes Candow 2018 creatine timing review"
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
  title: "Timing of Creatine Supplementation and Resistance Training: A Brief Review"
  authors: "Forbes SC, Candow DG"
  year: 2018
  journal: "Journal of Exercise and Nutrition"
  citation: "Forbes SC, Candow DG. Timing of Creatine Supplementation and Resistance Training: A Brief Review. Journal of Exercise and Nutrition. 2018;1(5):1-6."

  url: "https://www.journalofexerciseandnutrition.com/index.php/JEN/article/view/33"
researchEvidence:
  designKind: narrative_review
  designLabel: "Brief review with fixed-effect meta-analysis of three timing studies where possible"
  participantCount: 68

  populationLabel: "Resistance-training studies in male bodybuilders or healthy older adults; timing studies using creatine before versus after resistance training"
  durationLabel: "4 weeks, 12 weeks, or 8 months across included timing studies"
  aggregateRole: context
  cohortKey: "creatine-timing-resistance-training-review"
protocolEvidence:
  -
    protocolKey: protocol_variant:creatine-supplementation/creatine-monohydrate
    groupId: "timing-and-resistance-training"
    stance: mixed
    scope: direct_protocol
    result: mixed
    headline: "Post-exercise creatine showed a lean-mass signal in a very small evidence base, but strength outcomes did not favor timing."
    implication: "Can support low-confidence timing guidance such as taking creatine near training, with no need to overstate post-workout superiority."
    caveat: "Only three timing studies were pooled, populations were heterogeneous, and statistical power was low."
    displayPriority: 64
evidenceBucket: "strength_hypertrophy_synthesis"
whyItMatters: "It is one of the few sources directly focused on creatine timing around resistance training, but it is too small to justify a strong timing rule."
potentialMurphEndpoints:
  - "lean tissue mass"
  - "body weight"
  - "upper-body strength"
  - "lower-body strength"
  - "kidney-function labs when available"
protocolTakeaway: "Direct protocol evidence with mixed results: post-exercise timing may modestly favor lean tissue mass, while strength shows no clear timing advantage."
murphTakeaway: "Consistency matters more than a strict clock; post-workout timing is reasonable but not mandatory based on this review."
studyDesign: "narrative_review"
modality: "supplement"
claimUse: supports-protocol
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **strength_hypertrophy_synthesis**.

**Findings:**
- From `source_artifact:journalofexerciseandnutrition-creatine-timing-2018-10-10`: pooled lean-tissue-mass data from three timing studies favored creatine immediately after resistance training over immediately before training (standardized mean difference about 0.52; 95% CI 0.03 to 1.00; p=0.04).
- From `source_artifact:journalofexerciseandnutrition-creatine-timing-2018-10-10`: pooled strength data did not show a timing advantage; the reported strength meta-analysis was essentially null.
- The review reports that one older-adult timing study found no kidney-function changes over 12 weeks, but the safety inference is limited by small sample size and population specificity.
- The authors explicitly caution that only three trials were available and that additional research is needed.

**Why it matters:** It is one of the few sources directly focused on creatine timing around resistance training, but it is too small to justify a strong timing rule.

**Potential experiment signals:**
- lean tissue mass
- body weight
- upper-body strength
- lower-body strength
- kidney-function labs when available

**Protocol takeaway:** Direct protocol evidence with mixed results: post-exercise timing may modestly favor lean tissue mass, while strength shows no clear timing advantage.

**Murph takeaway:** Consistency matters more than a strict clock; post-workout timing is reasonable but not mandatory based on this review.

**Limitations and population mismatch:** Brief review; three timing studies; mixed ages and training statuses; small samples; some included studies lacked placebo groups; mechanisms remain speculative.

**Claim use:** `supports-protocol`.

---
