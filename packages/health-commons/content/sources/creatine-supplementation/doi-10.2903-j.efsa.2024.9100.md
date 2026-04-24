---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.2903-j.efsa.2024.9100
slug: sources/creatine-supplementation/doi-10.2903-j.efsa.2024.9100
title: 'Creatine and improvement in cognitive function: Evaluation of a health claim pursuant to Article 13(5) of Regulation (EC) No 1924/2006'
summary: EFSA evaluated a proposed cognitive-function health claim for creatine and concluded that a cause-and-effect relationship was not established.
status: draft
quality: usable
aliases:
  - 'Creatine and improvement in cognitive function: Evaluation of a health claim pursuant to Article 13(5) of Regulation (EC) No 1924/2006'
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
  kind: guideline
  title: 'Creatine and improvement in cognitive function: Evaluation of a health claim pursuant to Article 13(5) of Regulation (EC) No 1924/2006'
  authors: EFSA Panel on Nutrition, Novel Foods and Food Allergens (NDA)
  year: 2024
  journal: EFSA Journal
  citation: 'EFSA Panel on Nutrition, Novel Foods and Food Allergens (NDA). Creatine and improvement in cognitive function: Evaluation of a health claim pursuant to Article 13(5) of Regulation (EC) No 1924/2006. EFSA Journal. 2024;22(11):e9100. doi:10.2903/j.efsa.2024.9100.'

  doi: 10.2903/j.efsa.2024.9100
  url: https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2024.9100
researchEvidence:
  designKind: guideline
  designLabel: Regulatory scientific opinion / health-claim evaluation

  populationLabel: Human cognitive-function intervention evidence submitted for a regulatory health claim; included healthy and disease-context studies.
  durationLabel: Mixed; acute high-dose studies and longer continuous supplementation were considered.
  aggregateRole: primary
  cohortKey: cohort:doi-10.2903-j.efsa.2024.9100
protocolEvidence:
  -
    protocolKey: protocol_variant:creatine-supplementation/creatine-monohydrate
    groupId: adjacent-cognition-bone-and-disease-treatment-claims
    stance: context_only
    scope: adjacent_variant
    result: not_efficacy_evidence
    headline: "Included in the protocol evidence landscape group: Adjacent cognition, bone, and disease-treatment claims."
    implication: "Use this source within that landscape group while preserving the source-specific extraction caveats."
    caveat: "Interpret alongside the source narrative and the protocol's stated scope limits."
    displayPriority: 90
  -
    protocolKey: protocol_variant:creatine-supplementation/creatine-monohydrate
    groupId: evidence-quality-and-interpretation-limits
    stance: mixed
    scope: general_guideline
    result: mixed
    headline: "Included in the protocol evidence landscape group: Evidence quality and interpretation limits."
    implication: "Use this source within that landscape group while preserving the source-specific extraction caveats."
    caveat: "Interpret alongside the source narrative and the protocol's stated scope limits."
    displayPriority: 90
  -
    protocolKey: protocol_variant:creatine-supplementation/creatine-monohydrate
    groupId: creatine-monohydrate
    stance: context_only
    scope: general_guideline
    result: not_efficacy_evidence
    headline: EFSA did not accept the cognitive-function health claim for creatine.
    implication: 'Use as a boundary source: cognition claims should not be generalized from sport-dose creatine evidence.'
    caveat: Regulatory claim evaluation, not a direct exercise-performance trial; acute high-dose signals were judged insufficient or not generalizable.
    displayPriority: 80
evidenceBucket: background_guidelines_external
whyItMatters: EFSA evaluated a proposed cognitive-function health claim for creatine and concluded that a cause-and-effect relationship was not established.
potentialMurphEndpoints:
  - self-rated cognition
  - reaction time
  - working-memory task
  - sleep/stress context
protocolTakeaway: Do not present creatine monohydrate as a proven cognitive-function protocol based on this source; keep it context-only.
murphTakeaway: Do not present creatine monohydrate as a proven cognitive-function protocol based on this source; keep it context-only.
studyDesign: guideline
modality: Creatine supplementation
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **background_guidelines_external**.

**Findings:**
- **null_result / Cognitive function:** EFSA did not accept creatine as proven to improve cognitive function under the evaluated health-claim dossier. Directness: `background`. Claim use: `context-only`.
- **limitation / Working memory and other cognitive domains:** Population, dose, and disease-status mismatches limit use of cognitive studies for a general creatine-monohydrate protocol. Directness: `background`. Claim use: `context-only`.

**Why it matters:** EFSA evaluated a proposed cognitive-function health claim for creatine and concluded that a cause-and-effect relationship was not established.

**Potential experiment signals:**
- self-rated cognition
- reaction time
- working-memory task
- sleep/stress context

**Protocol takeaway:** Do not present creatine monohydrate as a proven cognitive-function protocol based on this source; keep it context-only.

**Limitations and boundary notes:**
- Regulatory synthesis rather than a primary trial
- Study-level participant totals and individual effect sizes were not extracted here
- Not direct exercise-performance evidence
- Some positive signals were dose- and context-specific

**Extraction notes:**
- None beyond the source-specific caveats above.

**Claim use:** `context-only`.
