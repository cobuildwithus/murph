---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:utahhealth-cold-plunging-health-2023-03-24
slug: sources/cold-water-immersion/utahhealth-cold-plunging-health-2023-03-24
title: Cold Plunging and the Impact on Your Health
summary: Cold Plunging and the Impact on Your Health is an external public/protocol source for Cold Plunge; it is used for attribution, public expectation management, and safety boundaries rather than direct efficacy synthesis.
status: draft
quality: usable
categories:
- cold-water-immersion
- cold-plunge
relations:
- type: parent_family
  target: experiment_family:cold-water-immersion
- type: related_protocol
  target: protocol_variant:cold-water-immersion/cold-plunge
source:
  kind: web_page
  title: Cold Plunging and the Impact on Your Health
  authors: University of Utah Health
  year: 2023
  journal: University of Utah Health
  url: https://healthcare.utah.edu/healthfeed/2023/03/cold-plunging-and-impact-your-health
  citation: University of Utah Health. Cold Plunging and the Impact on Your Health. University of Utah Health. March 24, 2023. https://healthcare.utah.edu/healthfeed/2023/03/cold-plunging-and-impact-your-health.
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: e2c6abf23178ebc83507d5f30bd990e3a7e709d6543afc46625949ba4aac4bd7
    url: https://healthcare.utah.edu/healthfeed/2023/03/cold-plunging-and-impact-your-health
  canonicalUrl: https://healthcare.utah.edu/healthfeed/2023/03/cold-plunging-and-impact-your-health
  identityAliases:
  - Cold Plunging and the Impact on Your Health
  - University of Utah Health (March 24, 2023)
  - https://healthcare.utah.edu/healthfeed/2023/03/cold-plunging-and-impact-your-health
researchEvidence:
  designKind: other
  designLabel: Academic medical-center safety explainer
  populationLabel: General public considering cold plunging; emphasizes older adults, people with heart problems, and people taking certain medications.
  durationLabel: No follow-up; advises first plunges should be brief and not exceed a short maximum.
  cohortKey: cohort:utahhealth-cold-plunging-health-2023-03-24
  aggregateRole: context
  notes:
  - 'Intervention/exposure: Cold plunging at roughly cool-to-cold water temperatures with gradual exposure recommendations.'
  - 'Comparator/control: No comparator or control; public safety advice.'
  - 'Endpoints: immune claims; cardiovascular claims; rapid breathing; heart rate; blood pressure; cold shock symptoms; supervision/head-above-water'
  - 'Effect direction: States there is little evidence for immune or cardiovascular claims and that cold plunging can be harmful for some people.'
  - 'Safety/adverse-event notes: Flags cold-shock breathing and heart-rate/blood-pressure responses; recommends not plunging alone, keeping head above water, and stopping for adverse symptoms.'
  - 'Limitations: Public explainer, not original research.; Includes safety claims and general evidence boundaries but no effect estimates.; Temperature risk thresholds are public safety context, not controlled dose evidence.'
  - 'Population/directness caveat: General public and higher-risk populations; not a controlled screened cold-plunge cohort.'
  - 'Directness to Cold Plunge: direct_protocol_safety_context'
  - 'Cold Plunge extraction context: bucket=External protocol/public-claims context; directness=direct_protocol; claimUse=safety-only; priority=low'
sourceFindings:
- findingId: finding:utahhealth-cold-plunging-health-2023-03-24:little-evidence-immune-cvd
  sourceKey: source_artifact:utahhealth-cold-plunging-health-2023-03-24
  extractedFromArtifactId: art_utahhealth_cold_plunging_health_2023_03_24
  findingKind: context
  population: General public
  exposure: Cold plunging
  outcome: Immune and cardiovascular benefit claims
  summary: The source states that there is little evidence for cold-plunge immune or cardiovascular health claims and that cold plunging can be harmful for some people.
  evidenceUse:
  - context
  - safety
- findingId: finding:utahhealth-cold-plunging-health-2023-03-24:high-risk-screening
  sourceKey: source_artifact:utahhealth-cold-plunging-health-2023-03-24
  extractedFromArtifactId: art_utahhealth_cold_plunging_health_2023_03_24
  findingKind: safety
  population: Older adults, people with heart problems, people taking certain medications
  exposure: Cold plunging
  outcome: Medical screening
  summary: The source recommends talking with a clinician first, especially for older adults, people with heart problems, and those taking certain medications.
  evidenceUse:
  - safety
- findingId: finding:utahhealth-cold-plunging-health-2023-03-24:first-plunge-safety
  sourceKey: source_artifact:utahhealth-cold-plunging-health-2023-03-24
  extractedFromArtifactId: art_utahhealth_cold_plunging_health_2023_03_24
  findingKind: safety
  population: General public considering cold plunges
  exposure: Cold plunging
  outcome: First-session safety
  summary: The source recommends gradual preparation, not plunging alone, keeping the head above water, stopping with adverse symptoms, and keeping initial plunges brief.
  evidenceUse:
  - safety
coldPlungeExtraction:
  batchId: batch-004
  evidenceBucket: External protocol/public-claims context
  directness: direct_protocol
  claimUse: safety-only
  priority: low
  artifactRightsStatusGuess: permission_required
  identityResolutionStatus: new_source
aliases:
- Cold Plunging and the Impact on Your Health
- University of Utah Health (March 24, 2023)
- https://healthcare.utah.edu/healthfeed/2023/03/cold-plunging-and-impact-your-health
---

This source is included for **External protocol/public-claims context**.

**Findings:** The source states that there is little evidence for cold-plunge immune or cardiovascular health claims and that cold plunging can be harmful for some people. The source recommends talking with a clinician first, especially for older adults, people with heart problems, and those taking certain medications. The source recommends gradual preparation, not plunging alone, keeping the head above water, stopping with adverse symptoms, and keeping initial plunges brief.

**Why it matters:** Adds practical academic medical-center safety instructions and explicitly says immune/cardiovascular benefit claims have little evidence.

**Potential experiment signals:** rapid breathing; heart rate; blood pressure; cold shock symptoms; immune claims; cardiovascular claims.

**Protocol takeaway:** Use to preserve the no-strong-immune/cardiovascular-claim boundary and practical safety screening.

**Claim use:** `safety-only`.

**Population mismatch:** General public and higher-risk populations; not a controlled screened cold-plunge cohort.

**Limitations:** Public explainer, not original research. Includes safety claims and general evidence boundaries but no effect estimates. Temperature risk thresholds are public safety context, not controlled dose evidence.

**Artifact and rights note:** This extraction stores metadata and a source page draft only. No copyrighted PDF or page copy is included in Git; preserve the canonical URL and verify rights before storing any downloadable copy.
