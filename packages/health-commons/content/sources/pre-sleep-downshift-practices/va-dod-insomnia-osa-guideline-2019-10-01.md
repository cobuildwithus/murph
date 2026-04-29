---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:va-dod-insomnia-osa-guideline-2019-10-01
slug: sources/pre-sleep-downshift-practices/va-dod-insomnia-osa-guideline-2019-10-01
title: VA/DoD Clinical Practice Guideline for the Management of Chronic Insomnia Disorder and Obstructive Sleep Apnea
summary: 2019 VA/DoD guideline for chronic insomnia disorder and obstructive sleep apnea; includes an explicit insufficient-evidence boundary for mindfulness meditation.
status: draft
quality: usable
aliases:
  - VA/DoD 2019 insomnia/OSA guideline
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
  title: VA/DoD Clinical Practice Guideline for the Management of Chronic Insomnia Disorder and Obstructive Sleep Apnea
  authors: VA/DoD Clinical Practice Guideline Work Group
  year: 2019
  journal: U.S. Department of Veterans Affairs and U.S. Department of Defense
  citation: VA/DoD Clinical Practice Guideline Work Group. VA/DoD Clinical Practice Guideline for the Management of Chronic Insomnia Disorder and Obstructive Sleep Apnea. U.S. Department of Veterans Affairs and Department of Defense; 2019.
  url: https://www.govinfo.gov/content/pkg/govpub-va-purl-gpo151619/pdf/govpub-va-purl-gpo151619.pdf
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: a24e6e51185a43419e0806eee482096c94defed1909f3d429e39237a66ab3e9e
    url: https://www.govinfo.gov/content/pkg/govpub-va-purl-gpo151619/pdf/govpub-va-purl-gpo151619.pdf
  canonicalUrl: https://www.govinfo.gov/content/pkg/govpub-va-purl-gpo151619/pdf/govpub-va-purl-gpo151619.pdf
researchEvidence:
  designKind: guideline
  designLabel: Clinical practice guideline
  populationLabel: "Adults with chronic insomnia disorder and/or obstructive sleep apnea in VA, DoD, and community settings"
  durationLabel: Guideline evidence review; treatment duration varies by intervention
  aggregateRole: context
  cohortKey: va-dod-2019-insomnia-osa-cpg
evidenceBucket: guidelines_and_comparator_context
whyItMatters: It directly preserves the older VA/DoD mindfulness boundary and explains resource/time-delay concerns.
potentialMurphEndpoints:
  - mindfulness boundary
  - sleep efficiency
  - insomnia severity
  - sleep quality
  - CBT-I referral
protocolTakeaway: "Use as context-only boundary: mindfulness was neither recommended for nor against; self-experiment language must not imply clinical insomnia treatment efficacy."
murphTakeaway: The guideline allows general low-harm framing but warns against displacing more effective CBT-I resources.
studyDesign: Clinical practice guideline
modality: Clinical insomnia/OSA guideline; mindfulness boundary
claimUse: context-only
sourceFindings:

  -
    findingId: finding:va-dod-insomnia-osa-guideline-2019-10-01-mindfulness-neither-for-nor-against-2019
    sourceKey: source_artifact:va-dod-insomnia-osa-guideline-2019-10-01
    extractedFromArtifactId: art_va-dod-insomnia-osa-guideline-2019-10-01_canonical
    findingKind: context
    population: Adults with chronic insomnia disorder and/or OSA addressed by the VA/DoD guideline.
    exposure: Mindfulness meditation as a complementary/integrative health approach for chronic insomnia.
    outcome: "Recommendation boundary, insomnia severity, sleep efficiency, sleep quality, subjective wake time, and resource/allocation caveats."
    summary: "The 2019 VA/DoD guideline found insufficient evidence to recommend for or against mindfulness meditation for chronic insomnia. Its discussion reported that a six-RCT review with 330 participants found mindfulness was not superior to comparators for insomnia severity, sleep efficiency, or PSQI sleep quality, while single-item sleep quality and subjective total wake time showed some improvement; it also noted no direct harms identified but cautioned that failed mindfulness treatment could delay CBT-I and divert resources."
    evidenceUse:
      - context
      - safety
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **guidelines_and_comparator_context**.

**Findings:** The 2019 VA/DoD guideline found insufficient evidence to recommend for or against mindfulness meditation for chronic insomnia. Its discussion reported that a six-RCT review with 330 participants found mindfulness was not superior to comparators for insomnia severity, sleep efficiency, or PSQI sleep quality, while single-item sleep quality and subjective total wake time showed some improvement; it also noted no direct harms identified but cautioned that failed mindfulness treatment could delay CBT-I and divert resources.

**Why it matters:** It directly preserves the older VA/DoD mindfulness boundary and explains resource/time-delay concerns.

**Potential experiment signals:** mindfulness boundary, sleep efficiency, insomnia severity, sleep quality, CBT-I referral.

**Protocol takeaway:** Use as context-only boundary: mindfulness was neither recommended for nor against; self-experiment language must not imply clinical insomnia treatment efficacy.

**Claim use:** `context-only`.
