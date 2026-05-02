---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:healthquality-va-gov-insomnia-osa-cpg-2025-04-22"
slug: "sources/pre-sleep-downshift-practices/healthquality-va-gov-insomnia-osa-cpg-2025-04-22"
title: "VA/DoD Clinical Practice Guideline for the Management of Chronic Insomnia Disorder and Obstructive Sleep Apnea"
summary: "The guideline supports validated screening for insomnia and OSA and places CBT-I within the clinical treatment hierarchy for chronic insomnia; it is not evidence that a brief self-guided bedtime breathing or meditation..."
status: draft
quality: usable
categories:
  - pre-sleep-downshift-practices
relations:

  -
    type: related_protocol
    target: protocol_variant:pre-sleep-downshift-practices/pre-sleep-resonance-breathing-and-meditation
  -
    type: parent_family
    target: experiment_family:pre-sleep-downshift-practices
source:
  kind: "guideline"
  title: "VA/DoD Clinical Practice Guideline for the Management of Chronic Insomnia Disorder and Obstructive Sleep Apnea"
  authors: "VA/DoD Clinical Practice Guideline Work Group"
  journal: "U.S. Department of Veterans Affairs and U.S. Department of Defense"
  url: "https://www.healthquality.va.gov/guidelines/CD/insomnia/"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  aggregateRole: context
  cohortKey: "healthquality-va-gov-insomnia-osa-cpg-2025-04-22"
evidenceBucket: "Clinical guidelines and treatment-boundary context"
protocolTakeaway: "Most current combined insomnia/OSA boundary guideline found; directly relevant to onboarding screens for apnea symptoms, treatment-resistant hypertension, daytime sleepiness, and referral. Candidate rows merged: 3; cand..."
studyDesign: "guideline"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:healthquality-va-gov-insomnia-osa-cpg-2025-04-22/validated-screening-cbti-boundary"
    sourceKey: "source_artifact:healthquality-va-gov-insomnia-osa-cpg-2025-04-22"
    findingKind: safety
    population: "Adults with chronic insomnia disorder and/or suspected obstructive sleep apnea"
    exposure: "VA/DoD clinical guideline recommendations for insomnia and OSA"
    outcome: "Validated screening, CBT-I treatment hierarchy, sleep hygiene boundary, and OSA evaluation/treatment pathways"
    summary: "The guideline supports validated screening for insomnia and OSA and places CBT-I within the clinical treatment hierarchy for chronic insomnia; it is not evidence that a brief self-guided bedtime breathing or meditation protocol treats insomnia."
    evidenceUse:
      - safety
      - context
  -
    findingId: "finding:healthquality-va-gov-insomnia-osa-cpg-2025-04-22/mindfulness-insufficient-evidence-boundary"
    sourceKey: "source_artifact:healthquality-va-gov-insomnia-osa-cpg-2025-04-22"
    findingKind: context
    population: "Adults with chronic insomnia disorder in a clinical-guideline evidence review"
    exposure: "Mindfulness meditation, yoga, qigong, tai chi, acupuncture, herbal products, supplements, and other complementary approaches considered in the guideline"
    outcome: "No clear guideline endorsement for these modalities as chronic insomnia treatment"
    summary: "The guideline’s complementary-practice section is a boundary source: mindfulness meditation and related practices are not promoted as established insomnia treatment in this guideline, preserving a no-overclaim stance for the protocol."
    evidenceUse:
      - context
      - safety
---

The guideline supports validated screening for insomnia and OSA and places CBT-I within the clinical treatment hierarchy for chronic insomnia; it is not evidence that a brief self-guided bedtime breathing or meditation...

**Finding 1:** The guideline supports validated screening for insomnia and OSA and places CBT-I within the clinical treatment hierarchy for chronic insomnia; it is not evidence that a brief self-guided bedtime breathing or meditation protocol treats insomnia.

**Finding 2:** The guideline’s complementary-practice section is a boundary source: mindfulness meditation and related practices are not promoted as established insomnia treatment in this guideline, preserving a no-overclaim stance for the protocol.

**Murph use:** Most current combined insomnia/OSA boundary guideline found; directly relevant to onboarding screens for apnea symptoms, treatment-resistant hypertension, daytime sleepiness, and referral. Candidate rows merged: 3; candidateIds: candidate:direct-silent-meditation-bedtime:035, candidate:mindfulness-insomnia-adjacent:038, candidate:clinical-guidelines-boundaries:003; shards: 05-discovery-direct-silent-meditation-bedtime, 06-discovery-mindfulness-insomnia-adjacent, 11-discovery-clinical-guidelines-boundaries.
