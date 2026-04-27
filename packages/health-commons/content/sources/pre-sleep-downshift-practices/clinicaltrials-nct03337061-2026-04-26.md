---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:clinicaltrials-nct03337061-2026-04-26"
slug: "sources/pre-sleep-downshift-practices/clinicaltrials-nct03337061-2026-04-26"
title: "A Trial of Mindfulness Meditation for Chronic Insomnia"
summary: "The registry is direct to the chronic-insomnia meditation question, but retrieved source text did not provide completed results or an enrollment count; use it for protocol/outcome context, not efficacy."
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
  kind: other
  title: "A Trial of Mindfulness Meditation for Chronic Insomnia"
  url: "https://clinicaltrials.gov/study/NCT03337061"
researchEvidence:
  designKind: other
  designLabel: "rct"
  aggregateRole: context
  cohortKey: "clinicaltrials-nct03337061-2026-04-26"
evidenceBucket: "Direct or near-direct silent/bedtime meditation and dose evidence"
protocolTakeaway: "Direct chronic-insomnia trial registry record; source results/status before using any claim. Candidate rows merged: 1; candidateIds: candidate:meditation-duration-dose:040; shards: 07-discovery-meditation-duration-dose."
studyDesign: "rct"
claimUse: "context-only"
sourceFindings:
  -
    findingId: "finding:clinicaltrials-nct03337061-mobile-mindfulness-insomnia-protocol"
    sourceKey: "source_artifact:clinicaltrials-nct03337061-2026-04-26"
    findingKind: context
    population: "Adults older than 18 years with chronic insomnia criteria, including sleep-onset latency or wake after sleep onset greater than 30 minutes at least 3 nights per week for more than 6 months; exclusions included uncontrolled medical or psychiatric disease, major depressive episode, other sleep disorders, and hypnotic or sedating medications."
    exposure: "Mobile-app mindfulness intervention; the registry mirror describes low-dose mindfulness as 10 minutes daily, delivered using the Headspace app, in an open-label randomized parallel study without placebo control."
    outcome: "Planned outcomes included Insomnia Severity Index and actigraphy-derived wake time or total wake time, with mindfulness acceptability and mindfulness scale measures as secondary outcomes."
    summary: "The registry is direct to the chronic-insomnia meditation question, but retrieved source text did not provide completed results or an enrollment count; use it for protocol/outcome context, not efficacy."
    evidenceUse:
      - context
      - measurement
  -
    findingId: "finding:clinicaltrials-nct03337061-extensive-meditation-safety-boundary"
    sourceKey: "source_artifact:clinicaltrials-nct03337061-2026-04-26"
    findingKind: safety
    population: "Adults with insomnia recruited through a sleep centre; the registry background specifically distinguishes low-dose app practice from extensive retreat-like training."
    exposure: "Mindfulness meditation, especially higher-intensity or extensive practice in people predisposed to psychiatric illness."
    outcome: "Safety framing and adverse-effect boundary."
    summary: "The registry background notes adverse effects reported in people predisposed to psychiatric illness after extensive training such as a 10-day silent retreat, while stating that negative effects had not been reported from 8-week mindfulness interventions; this is a safety-context statement rather than trial adverse-event data."
    evidenceUse:
      - safety
      - context
---

The registry is direct to the chronic-insomnia meditation question, but retrieved source text did not provide completed results or an enrollment count; use it for protocol/outcome context, not efficacy.

**Finding 1:** The registry is direct to the chronic-insomnia meditation question, but retrieved source text did not provide completed results or an enrollment count; use it for protocol/outcome context, not efficacy.

**Finding 2:** The registry background notes adverse effects reported in people predisposed to psychiatric illness after extensive training such as a 10-day silent retreat, while stating that negative effects had not been reported from 8-week mindfulness interventions; this is a safety-context statement rather than trial adverse-event data.

**Murph use:** Direct chronic-insomnia trial registry record; source results/status before using any claim. Candidate rows merged: 1; candidateIds: candidate:meditation-duration-dose:040; shards: 07-discovery-meditation-duration-dose.
