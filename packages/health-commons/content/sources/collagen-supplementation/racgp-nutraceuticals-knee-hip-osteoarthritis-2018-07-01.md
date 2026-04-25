---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:racgp-nutraceuticals-knee-hip-osteoarthritis-2018-07-01
slug: sources/collagen-supplementation/racgp-nutraceuticals-knee-hip-osteoarthritis-2018-07-01
title: 'Nutraceuticals: recommendation for collagen in knee and/or hip osteoarthritis'
summary: RACGP 2018 guideline was unable to recommend for or against collagen for knee/hip OA, citing inconsistent low/very-low quality evidence.
status: draft
quality: usable
aliases:
- 'Nutraceuticals: recommendation for collagen in knee and/or hip osteoarthritis'
- racgp-nutraceuticals-knee-hip-osteoarthritis-2018-07-01
categories:
- collagen-supplementation
- joint-osteoarthritis
- background
- context-only
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: https://www.racgp.org.au/clinical-resources/clinical-guidelines/key-racgp-guidelines/view-all-racgp-guidelines/knee-and-hip-osteoarthritis/interventions/nutraceuticals
  canonicalUrl: https://www.racgp.org.au/clinical-resources/clinical-guidelines/key-racgp-guidelines/view-all-racgp-guidelines/knee-and-hip-osteoarthritis/interventions/nutraceuticals
  identityAliases:
  - 'Nutraceuticals: recommendation for collagen in knee and/or hip osteoarthritis'
  - racgp-nutraceuticals-knee-hip-osteoarthritis-2018-07-01
source:
  kind: guideline
  title: 'Nutraceuticals: recommendation for collagen in knee and/or hip osteoarthritis'
  authors: Royal Australian College of General Practitioners
  citation: 'The Royal Australian College of General Practitioners. Guideline for the management of knee and hip osteoarthritis. 2nd edn. East Melbourne, Vic: RACGP; 2018.'
  year: 2018
  journal: RACGP Guideline
  url: https://www.racgp.org.au/clinical-resources/clinical-guidelines/key-racgp-guidelines/view-all-racgp-guidelines/knee-and-hip-osteoarthritis/interventions/nutraceuticals
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline recommendation
  populationLabel: People with knee and/or hip osteoarthritis
  durationLabel: Guideline; short-term evidence base noted as 13-26 weeks for collagen
  cohortKey: racgp-2018-collagen-nutraceuticals-knee-hip-oa
  aggregateRole: primary
evidenceBucket: joint-osteoarthritis
whyItMatters: One of the clearest guideline-level guardrails against overclaiming collagen for OA.
potentialMurphEndpoints:
- pain
- function
- GI adverse events
- guideline recommendation strength
- evidence quality
protocolTakeaway: Use for neutral/uncertain recommendation language and GI safety caveat.
murphTakeaway: Claims should say evidence is uncertain/inconsistent; monitor GI symptoms.
studyDesign: Clinical guideline recommendation
modality: RACGP collagen nutraceutical recommendation
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: joint-osteoarthritis
  directness: background
  claimUse: context-only
  priority: low
  batchId: batch-003
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **joint-osteoarthritis**.

**Findings:** The RACGP 2018 guideline gave collagen for knee/hip OA a conditional neutral recommendation, with low evidence for knee OA and very low evidence for hip OA. It noted short-term pain benefits in pooled studies but serious inconsistency, no effect on function in available data, knee-only study populations, potential publication/industry bias, and relatively safe use with a non-statistically significant increase in GI adverse events.

**Why it matters:** One of the clearest guideline-level guardrails against overclaiming collagen for OA.

**Potential experiment signals:** pain, function, GI adverse events, guideline recommendation strength, evidence quality

**Protocol takeaway:** Use for neutral/uncertain recommendation language and GI safety caveat.

**Claim use:** `context-only`.
