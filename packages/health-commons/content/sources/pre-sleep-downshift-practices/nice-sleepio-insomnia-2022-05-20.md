---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-sleepio-insomnia-2022-05-20
slug: sources/pre-sleep-downshift-practices/nice-sleepio-insomnia-2022-05-20
title: Sleepio to treat insomnia and insomnia symptoms
summary: "NICE HealthTech guidance recommending Sleepio, a digital CBT-I program, as a cost-saving option for insomnia and insomnia symptoms in primary care for people otherwise offered sleep hygiene or sleeping pills."
status: draft
quality: usable
aliases:
  - NICE HTG624 Sleepio insomnia guidance
categories:
  - pre-sleep-downshift-practices
relations:
  -
    type: related_protocol
    target: protocol_variant:pre-sleep-downshift-practices/pre-sleep-silent-meditation
  -
    type: parent_family
    target: experiment_family:pre-sleep-downshift-practices
source:
  kind: guideline
  title: Sleepio to treat insomnia and insomnia symptoms
  authors: National Institute for Health and Care Excellence
  year: 2022
  journal: NICE HealthTech guidance HTG624
  citation: National Institute for Health and Care Excellence. Sleepio to treat insomnia and insomnia symptoms. NICE HealthTech guidance HTG624. Published 20 May 2022.
  url: https://www.nice.org.uk/guidance/htg624
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: f39504b265df78eed6a0a5bfa638cae5c1fc06d9cde9391c8d3bd5a2383224f5
    url: https://www.nice.org.uk/guidance/htg624
  canonicalUrl: https://www.nice.org.uk/guidance/htg624
researchEvidence:
  designKind: guideline
  designLabel: Health technology guidance
  populationLabel: People with insomnia or insomnia symptoms in primary care who would otherwise be offered sleep hygiene or sleeping pills; medical assessment first for higher-risk sleep disorder conditions
  durationLabel: Digital CBT-I program pathway; guidance not a trial
  aggregateRole: context
  cohortKey: nice-2022-sleepio-htg624
evidenceBucket: guidelines_and_comparator_context
whyItMatters: It distinguishes evidence-based digital CBT-I from unguided bedtime meditation apps or rituals.
potentialMurphEndpoints:
  - insomnia symptoms
  - digital CBT-I comparator
  - primary care pathway
  - medical assessment boundary
protocolTakeaway: Use as digital-CBT-I comparator context; do not cite it for meditation apps or silent meditation.
murphTakeaway: Digital CBT-I has a separate evidence and health-technology assessment pathway from silent bedtime meditation.
studyDesign: Health technology guidance
modality: Digital CBT-I comparator guidance
claimUse: context-only
sourceFindings:
  -
    findingId: finding:nice-sleepio-insomnia-2022-05-20-digital-cbti-comparator
    sourceKey: source_artifact:nice-sleepio-insomnia-2022-05-20
    extractedFromArtifactId: art_nice-sleepio-insomnia-2022-05-20_canonical
    findingKind: context
    population: People with insomnia or insomnia symptoms in primary care who would otherwise receive sleep hygiene or sleeping pills.
    exposure: Sleepio digital CBT-I program.
    outcome: NICE recommendation and medical-assessment boundary for higher-risk sleep disorder conditions.
    summary: "NICE HTG624 recommends Sleepio as a cost-saving option for treating insomnia and insomnia symptoms in primary care for people who would otherwise be offered sleep hygiene or sleeping pills, and advises medical assessment before referral for people at higher risk of other sleep disorder conditions. This is digital CBT-I comparator context, not evidence for unguided silent meditation."
    evidenceUse:
      - context
      - safety
murphV1Priority: High
pdfRightsStatus: permission_required
---
This source is included for **guidelines_and_comparator_context**.

**Findings:** NICE HTG624 recommends Sleepio as a cost-saving option for treating insomnia and insomnia symptoms in primary care for people who would otherwise be offered sleep hygiene or sleeping pills, and advises medical assessment before referral for people at higher risk of other sleep disorder conditions. This is digital CBT-I comparator context, not evidence for unguided silent meditation.

**Why it matters:** It distinguishes evidence-based digital CBT-I from unguided bedtime meditation apps or rituals.

**Potential experiment signals:** insomnia symptoms, digital CBT-I comparator, primary care pathway, medical assessment boundary.

**Protocol takeaway:** Use as digital-CBT-I comparator context; do not cite it for meditation apps or silent meditation.

**Claim use:** `context-only`.
