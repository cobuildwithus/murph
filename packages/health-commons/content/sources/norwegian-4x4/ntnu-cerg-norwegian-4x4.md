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
protocolTakeaway: "Use as the recipe anchor for warm-up, four 4-minute hard intervals, 3-minute active recoveries, and cooldown; do not read it as outcome or safety proof."
studyDesign: "Public protocol guidance"
modality: Aerobic high-intensity interval training / Norwegian 4x4 context
norwegian4x4Focus: "Direct support"
claimUse: supports-protocol
murphV1Priority: High
pdfRightsStatus: unknown
aliases:
  - "ntnu-cerg-norwegian-4x4"
---

This source is included for **Protocol dose and design**.

## Quick read

- **Source type:** Public protocol guidance (2024).
- **People studied or addressed:** Public-facing exercise guidance.
- **Role in Murph:** direct or close support for the cardio-fitness claim; supports evidence; directly about the protocol dose or a very close implementation detail.
- **Most relevant Murph signals:** estimated VO2max / cardio-fitness proxy, session heart-rate fidelity, heart-rate recovery, symptoms and adherence.

## Why it matters for Norwegian 4x4

Public-facing source for the commonly cited Norwegian 4x4 session structure.

## What it found

**Findings:** Defines the commonly cited Norwegian 4x4 dose: warm up, four 4-minute hard intervals, active recoveries, and cooldown.

## How Murph should use it

Use this as the recipe anchor for the Murph protocol, not as outcome evidence.

Use as the recipe anchor for warm-up, four 4-minute hard intervals, 3-minute active recoveries, and cooldown; do not read it as outcome or safety proof.

## Important limits

Public protocol guidance does not estimate benefit size or safety for a specific user.

The safe interpretation is narrower than “4x4 is always better.” Keep the population, supervision level, comparator, and exact interval dose visible before applying this source to a home wearable experiment.

## Plain-language takeaway

For a generally healthy user, this belongs in the evidence pile that makes a 6-week 4x4 fitness test plausible, as long as the session is actually hard enough and recovery stays reasonable.
