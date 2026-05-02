---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.2196-72786"
slug: "sources/pre-sleep-downshift-practices/doi-10.2196-72786"
title: "Examining the Dose-Response Effects of Mindfulness Meditation Interventions on Well-Being: Protocol for a Randomized Controlled Trial"
summary: "The protocol directly addresses daily mindfulness practice duration but not sleep or bedtime. It planned at least 688 participants and described the current dose-response evidence base as methodologically limited."
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
  kind: "journal_article"
  title: "Examining the Dose-Response Effects of Mindfulness Meditation Interventions on Well-Being: Protocol for a Randomized Controlled Trial"
  authors: "Nicholas Bowles, Alexander Burger, Jonathan N. Davies, Julie A. Simpson, et al."
  journal: "JMIR Research Protocols"
  doi: "10.2196/72786"
  url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12344385/"
researchEvidence:
  designKind: "other"
  designLabel: "other"
  aggregateRole: context
  cohortKey: "doi-10.2196-72786"
evidenceBucket: "Direct or near-direct silent/bedtime meditation and dose evidence"
protocolTakeaway: "Protocol explicitly tests dose-response and tracks adverse experiences; results not yet sourceable. Candidate rows merged: 1; candidateIds: candidate:meditation-duration-dose:012; shards: 07-discovery-meditation-duratio..."
studyDesign: "other"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:doi-10.2196-72786-mindfulness-dose-protocol"
    sourceKey: "source_artifact:doi-10.2196-72786"
    findingKind: context
    population: "Healthy adults aged 18 to 65 years in an online mindfulness trial; not an insomnia or bedtime population."
    exposure: "Randomization to 4-week online mindfulness courses with daily practice lengths of 10, 20, or 30 minutes, compared with a minimally active 4-minute control condition."
    outcome: "Primary well-being and secondary psychological outcomes; daily and weekly outcomes; results were estimated for publication by March 2026."
    summary: "The protocol directly addresses daily mindfulness practice duration but not sleep or bedtime. It planned at least 688 participants and described the current dose-response evidence base as methodologically limited."
    evidenceUse:
      - adjacent_variant
      - context
      - measurement
  -
    findingId: "finding:doi-10.2196-72786-dose-evidence-gap"
    sourceKey: "source_artifact:doi-10.2196-72786"
    findingKind: context
    population: "Mindfulness meditation research on mental health and well-being, not insomnia-specific cohorts."
    exposure: "Experimentally manipulated mindfulness practice dose and prior home-practice dose evidence."
    outcome: "Dose-response uncertainty."
    summary: "The paper states that evidence on daily mindfulness dose-response remains in its infancy; prior experimentally manipulated session-duration studies were limited, and nonrandomized home-practice correlations cannot establish causation."
    evidenceUse:
      - context
  -
    findingId: "finding:doi-10.2196-72786-adverse-experience-monitoring"
    sourceKey: "source_artifact:doi-10.2196-72786"
    findingKind: safety
    population: "Healthy adult online mindfulness participants."
    exposure: "Varying daily mindfulness practice doses over 4 weeks."
    outcome: "Possible adverse experiences."
    summary: "The protocol includes systematic monitoring for possible adverse experiences and explicitly frames whether higher mindfulness doses could be riskier as a study concern; no outcome or adverse-event results were available in the protocol article."
    evidenceUse:
      - safety
      - context
---

The protocol directly addresses daily mindfulness practice duration but not sleep or bedtime. It planned at least 688 participants and described the current dose-response evidence base as methodologically limited.

**Finding 1:** The protocol directly addresses daily mindfulness practice duration but not sleep or bedtime. It planned at least 688 participants and described the current dose-response evidence base as methodologically limited.

**Finding 2:** The paper states that evidence on daily mindfulness dose-response remains in its infancy; prior experimentally manipulated session-duration studies were limited, and nonrandomized home-practice correlations cannot establish causation.

**Finding 3:** The protocol includes systematic monitoring for possible adverse experiences and explicitly frames whether higher mindfulness doses could be riskier as a study concern; no outcome or adverse-event results were available in the protocol article.

**Murph use:** Protocol explicitly tests dose-response and tracks adverse experiences; results not yet sourceable. Candidate rows merged: 1; candidateIds: candidate:meditation-duration-dose:012; shards: 07-discovery-meditation-duration-dose.
