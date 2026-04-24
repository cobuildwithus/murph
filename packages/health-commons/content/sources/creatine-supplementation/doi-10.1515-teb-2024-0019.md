---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1515-teb-2024-0019"
slug: "sources/creatine-supplementation/doi-10.1515-teb-2024-0019"
title: "Creatine and strength training in older adults: an update."
summary: "Open-access update of meta-analytic evidence in adults over 50 combining creatine with strength training; lean tissue mass and upper-body strength improved, while lower-body strength and bone-mineral-density effects were not clearly positive."
status: draft
quality: usable
aliases:
  - "Creatine and strength training in older adults: an update"
  - "Forbes Candow 2024 older adults creatine update"
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
  title: "Creatine and strength training in older adults: an update."
  authors: "Forbes S, Candow D"
  year: 2024
  journal: "Translational Exercise Biomedicine"
  citation: "Forbes S, Candow D. Creatine and strength training in older adults: an update. Translational Exercise Biomedicine. 2024;1(3-4):212-222. doi:10.1515/teb-2024-0019."

  doi: "10.1515/teb-2024-0019"
  url: "https://www.degruyterbrill.com/document/doi/10.1515/teb-2024-0019/html"
researchEvidence:
  designKind: narrative_review
  designLabel: "Updated narrative/meta-analytic review of creatine plus strength training in older adults"
  participantCount: 746

  populationLabel: "Healthy adults over 50 years participating in strength-training trials"
  durationLabel: "Included randomized trials of at least 5 weeks; specific durations vary"
  aggregateRole: context
  cohortKey: "older-adults-strength-training-review"
protocolEvidence:
  -
    protocolKey: protocol_variant:creatine-supplementation/creatine-monohydrate
    groupId: subgroup-modifiers-and-life-stage-boundaries
    stance: mixed
    scope: adjacent_variant
    result: mixed
    headline: "Included in the protocol evidence landscape group: Subgroup modifiers and life-stage boundaries."
    implication: "Use this source within that landscape group while preserving the source-specific extraction caveats."
    caveat: "Interpret alongside the source narrative and the protocol's stated scope limits."
    displayPriority: 90
  -
    protocolKey: protocol_variant:creatine-supplementation/creatine-monohydrate
    groupId: "older-adult-strength-training-context"
    stance: context_only
    scope: general_guideline
    result: mixed
    headline: "Creatine plus strength training in older adults improved lean mass and upper-body strength but not lower-body strength or BMD in the reported meta-analyses."
    implication: "Useful as population-specific background; do not generalize directly to all Murph users."
    caveat: "Older-adult strength-training context and review-level evidence; not a direct Murph self-experiment trial."
    displayPriority: 50
evidenceBucket: "background_guidelines_external"
whyItMatters: "Older adults may respond differently, and the source preserves both positive and null outcomes relevant to strength, body composition, and bone expectations."
potentialMurphEndpoints:
  - "lean tissue mass"
  - "upper-body strength"
  - "lower-body strength"
  - "bone-mineral density"
  - "cognition"
protocolTakeaway: "Context-only: in older adults with strength training, creatine has a lean-mass and upper-body-strength signal but mixed/null bone and lower-body strength findings."
murphTakeaway: "Benefits in older adults may be strongest when paired with strength training; bone claims should stay cautious."
studyDesign: "narrative_review"
modality: "supplement"
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **background_guidelines_external**.

**Findings:**
- From `source_artifact:doi-10.1515-teb-2024-0019`: meta-analytic lean-tissue-mass results in older adults favored creatine plus strength training by a mean difference of 1.18 kg (95% CI 0.70 to 1.67; p<0.00001; n=746).
- From `source_artifact:doi-10.1515-teb-2024-0019`: upper-body strength favored creatine with a standardized mean difference of 0.24 (95% CI 0.05 to 0.43; p=0.02; n=693).
- From `source_artifact:doi-10.1515-teb-2024-0019`: lower-body strength did not clearly differ (SMD 0.17; 95% CI -0.03 to 0.38; p=0.09), and whole-body, femoral-neck, and lumbar-spine BMD did not show clear effects.
- Limitations include the older-adult-only population, non-comprehensive review design, possible bias, body-composition measurement constraints, and limited intramuscular or brain creatine measures.

**Why it matters:** Older adults may respond differently, and the source preserves both positive and null outcomes relevant to strength, body composition, and bone expectations.

**Potential experiment signals:**
- lean tissue mass
- upper-body strength
- lower-body strength
- bone-mineral density
- cognition

**Protocol takeaway:** Context-only: in older adults with strength training, creatine has a lean-mass and upper-body-strength signal but mixed/null bone and lower-body strength findings.

**Murph takeaway:** Benefits in older adults may be strongest when paired with strength training; bone claims should stay cautious.

**Limitations and population mismatch:** Population mismatch for younger or non-training users; not a comprehensive systematic review; outcome-specific aggregate sample sizes vary.

**Claim use:** `context-only`.

---
