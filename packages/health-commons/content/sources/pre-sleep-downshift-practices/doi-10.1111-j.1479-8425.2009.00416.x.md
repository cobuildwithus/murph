---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1111-j.1479-8425.2009.00416.x
slug: sources/pre-sleep-downshift-practices/doi-10.1111-j.1479-8425.2009.00416.x
title: Practitioners of vipassana meditation exhibit enhanced slow wave sleep and REM sleep states across different age groups
summary: "Cross-sectional whole-night polysomnography comparison of healthy male Vipassana meditators and controls; useful as objective sleep-architecture background only, not causal or direct protocol evidence."
status: draft
quality: usable
aliases:
  - Vipassana meditation and slow wave sleep
  - Pattanashetty et al. 2010 Vipassana PSG
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
  kind: journal_article
  title: Practitioners of vipassana meditation exhibit enhanced slow wave sleep and REM sleep states across different age groups
  authors: Ravindra Pattanashetty; Sulekha Sathiamma; SathyaPrabha Talakkad; Pradhan Nityananda; Raju Trichur; Bindu M. Kutty
  year: 2010
  journal: Sleep and Biological Rhythms
  citation: "Pattanashetty R, Sathiamma S, Talakkad S, Nityananda P, Trichur R, Kutty BM. Practitioners of vipassana meditation exhibit enhanced slow wave sleep and REM sleep states across different age groups. Sleep and Biological Rhythms. 2010;8:34-41. doi:10.1111/j.1479-8425.2009.00416.x."
  doi: 10.1111/j.1479-8425.2009.00416.x
  url: https://doi.org/10.1111/j.1479-8425.2009.00416.x
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1111/j.1479-8425.2009.00416.x
    titleHash: 3b3e2861690ca19798207460633b61d1aeac639ee60371baf519a3fcd221fe1b
    url: https://doi.org/10.1111/j.1479-8425.2009.00416.x
  canonicalUrl: https://doi.org/10.1111/j.1479-8425.2009.00416.x
researchEvidence:
  designKind: cross_sectional
  designLabel: Cross-sectional whole-night polysomnography comparison
  participantCount: 91
  participantCountKind: reported
  populationLabel: Healthy male subjects aged 30-60 years; Vipassana meditators compared with non-meditating controls.
  durationLabel: Single cross-sectional whole-night PSG assessment; no bedtime intervention duration or follow-up extracted from accessible abstract.
  aggregateRole: context
  cohortKey: cohort:doi-10.1111-j.1479-8425.2009.00416.x-vipassana-psg
  notes:
    - "Publisher abstract reports control n=46 and meditation n=45; eligible sleep variables were evaluated among subjects with sleep efficiency index above 85%."
evidenceBucket: background_context
directness: background
whyItMatters: "This source offers objective PSG context linking long-term Vipassana practice with sleep architecture, but its cross-sectional design and population mismatch make it inappropriate for direct protocol claims."
potentialMurphEndpoints:
  - biomarker:deep-sleep-minutes
  - biomarker:rem-sleep-minutes
  - biomarker:sleep-architecture
  - outcome:sleep-cycles
protocolTakeaway: "Long-term Vipassana practitioners were reported to have different PSG sleep architecture than controls, but the study does not test silent meditation before bed and cannot establish causality."
murphTakeaway: "For Murph, this can be used as low-priority mechanistic or measurement context only, with clear caveats about healthy male participants, practitioner status, and absent adverse-event reporting."
studyDesign: Cross-sectional PSG observational comparison.
modality: Long-term Vipassana meditation practitioner status assessed with whole-night polysomnography.
claimUse: context-only
sourceFindings:

  -
    findingId: finding:doi-10.1111-j.1479-8425.2009.00416.x-vipassana-psg-sleep-architecture
    sourceKey: source_artifact:doi-10.1111-j.1479-8425.2009.00416.x
    extractedFromArtifactId: art-batch011-doi-10.1111-j.1479-8425.2009.00416.x
    findingKind: mechanistic
    population: "Healthy male subjects aged 30 to 60 years with sleep efficiency index above 85%, comparing control participants (n=46) with Vipassana meditators (n=45)."
    exposure: Vipassana meditation practitioner status; not an assigned bedtime intervention.
    outcome: "Whole-night polysomnography sleep architecture, including slow-wave sleep, REM sleep, and number of sleep cycles."
    summary: "The publisher abstract reports whole-night PSG in 91 healthy male subjects and states that Vipassana meditators had enhanced slow-wave sleep and REM sleep states with an enhanced number of sleep cycles across age groups, while control groups had a pronounced age-associated decrease in slow-wave sleep states."
    evidenceUse:
      - mechanism
      - measurement
      - context
  -
    findingId: finding:doi-10.1111-j.1479-8425.2009.00416.x-population-and-causality-boundary
    sourceKey: source_artifact:doi-10.1111-j.1479-8425.2009.00416.x
    extractedFromArtifactId: art-batch011-doi-10.1111-j.1479-8425.2009.00416.x
    findingKind: context
    population: Healthy male long-term Vipassana meditators and non-meditating controls aged 30 to 60 years.
    exposure: Meditation-practitioner status measured cross-sectionally.
    outcome: Causality and population-match boundary.
    summary: "The accessible publisher record describes a cross-sectional PSG comparison rather than a randomized or prospective bedtime meditation intervention. It is restricted to healthy male participants and does not test a pre-sleep silent meditation dose, so it cannot support causal claims for the Silent Meditation Before Bed protocol."
    evidenceUse:
      - context
  -
    findingId: finding:doi-10.1111-j.1479-8425.2009.00416.x-safety-not-reported
    sourceKey: source_artifact:doi-10.1111-j.1479-8425.2009.00416.x
    extractedFromArtifactId: art-batch011-doi-10.1111-j.1479-8425.2009.00416.x
    findingKind: safety
    population: Healthy male Vipassana meditators and controls in the accessible publisher abstract.
    exposure: Vipassana meditation practitioner status.
    outcome: Adverse events or tolerability reporting.
    summary: "The accessible abstract and publisher page do not report adverse events or tolerability outcomes. This should be treated as absence of safety reporting, not evidence that the practice is risk-free."
    evidenceUse:
      - safety
      - context
murphV1Priority: Low
pdfRightsStatus: paywalled
---
This source is included for **background_context**.

**Findings:**

- `finding:doi-10.1111-j.1479-8425.2009.00416.x-vipassana-psg-sleep-architecture` — The publisher abstract reports whole-night PSG in 91 healthy male subjects and states that Vipassana meditators had enhanced slow-wave sleep and REM sleep states with an enhanced number of sleep cycles across age groups, while control groups had a pronounced age-associated decrease in slow-wave sleep states.
- `finding:doi-10.1111-j.1479-8425.2009.00416.x-population-and-causality-boundary` — The accessible publisher record describes a cross-sectional PSG comparison rather than a randomized or prospective bedtime meditation intervention. It is restricted to healthy male participants and does not test a pre-sleep silent meditation dose, so it cannot support causal claims for the Silent Meditation Before Bed protocol.
- `finding:doi-10.1111-j.1479-8425.2009.00416.x-safety-not-reported` — The accessible abstract and publisher page do not report adverse events or tolerability outcomes. This should be treated as absence of safety reporting, not evidence that the practice is risk-free.

**Why it matters:** This source offers objective PSG context linking long-term Vipassana practice with sleep architecture, but its cross-sectional design and population mismatch make it inappropriate for direct protocol claims.

**Potential experiment signals:**

- biomarker:deep-sleep-minutes
- biomarker:rem-sleep-minutes
- biomarker:sleep-architecture
- outcome:sleep-cycles

**Protocol takeaway:** Long-term Vipassana practitioners were reported to have different PSG sleep architecture than controls, but the study does not test silent meditation before bed and cannot establish causality.

**Claim use:** `context-only`.
