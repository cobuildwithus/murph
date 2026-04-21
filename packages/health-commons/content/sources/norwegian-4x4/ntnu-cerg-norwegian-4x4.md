---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ntnu-cerg-norwegian-4x4
slug: sources/norwegian-4x4/ntnu-cerg-norwegian-4x4
title: "CERG's 4x4 interval training advice"
summary: "Public-facing source for the commonly cited Norwegian 4x4 session structure."
status: draft
quality: usable
categories:
  - norwegian-4x4
  - hiit
  - exercise
relations:
  -
    type: related_protocol
    target: protocol_variant:norwegian-4x4/norwegian-4x4
  -
    type: parent_family
    target: experiment_family:norwegian-4x4
source:
  kind: external_protocol
  title: "CERG's 4x4 interval training advice"
  authors: "Cardiac Exercise Research Group, NTNU"
  year: 2024
  journal: "NTNU public protocol page"
  citation: "Cardiac Exercise Research Group, NTNU. CERG's 4x4 interval training advice. NTNU public protocol page. 2024."
  url: https://www.ntnu.edu/cerg/advice
researchEvidence:
  designKind: "expert_protocol"
  designLabel: "Public protocol guidance"
  populationLabel: "Public-facing exercise guidance"
  aggregateRole: "context"
protocolEvidence:
  -
    protocolKey: protocol_variant:norwegian-4x4/norwegian-4x4
    groupId: supports-fitness-claim
    stance: supports
    scope: direct_protocol
    result: not_efficacy_evidence
    headline: "Defines the commonly cited Norwegian 4x4 dose: warm up, four 4-minute hard intervals, active recoveries, and cooldown."
    implication: "Use this as the recipe anchor for the Murph protocol, not as outcome evidence."
    caveat: "Public protocol guidance does not estimate benefit size or safety for a specific user."
    displayPriority: 10
evidenceBucket: "Protocol dose and design"
whyItMatters: "Public-facing source for the commonly cited Norwegian 4x4 session structure."
potentialMurphEndpoints:
  - estimated VO2max / cardio-fitness proxy
  - session heart-rate fidelity
  - heart-rate recovery
  - symptoms and adherence
protocolTakeaway: "Use only within the stated claimUse boundary when building the Norwegian 4x4 protocol."
studyDesign: "See source metadata and bibliography for exact design."
modality: Aerobic high-intensity interval training / Norwegian 4x4 context
norwegian4x4Focus: "Direct support"
claimUse: supports-protocol
murphV1Priority: High
pdfRightsStatus: unknown
aliases:
  - "ntnu-cerg-norwegian-4x4"
---

This source is included for **Protocol dose and design**.

**Why it matters:** Public-facing source for the commonly cited Norwegian 4x4 session structure.

**Protocol takeaway:** Use this source only within its `claimUse: supports-protocol` boundary. Do not use safety-only, mixed clinical, or adjacent-variant evidence as direct support for a general unsupervised self-experiment claim.
