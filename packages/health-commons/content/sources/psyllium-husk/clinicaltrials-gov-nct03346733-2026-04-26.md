---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct03346733-2026-04-26"
slug: "sources/psyllium-husk/clinicaltrials-gov-nct03346733-2026-04-26"
title: "The Effect of Psyllium Fibre (Plantago Ovata) on LDL-cholesterol and Emerging Lipid Targets, Non-HDL-cholesterol and Apolipoprotein-B: A Systematic Review and Meta-analysis of Randomized Controlled Trials"
summary: "ClinicalTrials.gov registry/protocol record for a psyllium-specific systematic review and meta-analysis focused on LDL-C, non-HDL-C, and apoB."
status: "draft"
quality: "usable"
aliases:
  - "NCT03346733"
  - "Psyllium LDL non-HDL apoB meta-analysis protocol"
categories:
  - "psyllium-husk"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:psyllium-husk"
source:
  kind: "web_page"
  title: "The Effect of Psyllium Fibre (Plantago Ovata) on LDL-cholesterol and Emerging Lipid Targets, Non-HDL-cholesterol and Apolipoprotein-B: A Systematic Review and Meta-analysis of Randomized Controlled Trials"
  authors: "Registry sponsor/record holder: Unity Health Toronto"
  year: 2017
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. The Effect of Psyllium Fibre (Plantago Ovata) on LDL-cholesterol and Emerging Lipid Targets, Non-HDL-cholesterol and Apolipoprotein-B: A Systematic Review and Meta-analysis of Randomized Controlled Trials. NCT03346733. Registry record. Extracted 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT03346733"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT03346733"
    titleHash: "ce324177ab31f9a56733cbcd330d71e5bff30b32d24a06f23ec2975281b59f21"
    url: "https://clinicaltrials.gov/study/NCT03346733"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT03346733"
researchEvidence:
  designKind: "meta_analysis"
  designLabel: "Registered systematic review and meta-analysis protocol"
  participantCount: 1000
  participantCountKind: "approximate"
  populationLabel: "RCT participants in psyllium fibre trials, as planned for review inclusion; trial-level populations were not individually extracted from this registry record."
  durationLabel: "Eligible RCTs required at least 3 weeks of follow-up."
  aggregateRole: "synthesis"
  cohortKey: "nct03346733"
  notes:
    - "Directness to protocol: direct_protocol."
    - "Population mismatch: No direct participant population for self-experiment translation because this is a review protocol."
    - "Protocol/registration source rather than final meta-analysis results."
    - "Registry enrollment figure is an aggregate/protocol estimate, not a primary-trial sample size."
    - "Published meta-analysis results require separate source extraction."
sourceKind: "trial_registry"
evidenceBucket: "Registries and unpublished protocols"
directness: "direct_protocol"
whyItMatters: "Defines the eligibility and extraction logic behind a modern psyllium lipid meta-analysis, including minimum follow-up and isolatable psyllium effects."
potentialMurphEndpoints:
  - "LDL-C"
  - "non-HDL-C"
  - "apolipoprotein B"
  - "dose"
  - "follow-up duration"
  - "risk of bias"
  - "GRADE certainty"
protocolTakeaway: "Use as context for which trial features matter in the protocol synthesis; the registry/protocol record is not itself the meta-analysis result source."
murphTakeaway: "High-value extraction-method record: it shows which lipid endpoints and minimum durations were prespecified for psyllium RCT synthesis."
studyDesign: "Systematic review and meta-analysis protocol for randomized controlled trials"
modality: "psyllium husk / Plantago ovata fiber intervention or registry context"
claimUse: "context-only"
limitations:
  - "Protocol/registration source rather than final meta-analysis results."
  - "Registry enrollment figure is an aggregate/protocol estimate, not a primary-trial sample size."
  - "Published meta-analysis results require separate source extraction."
populationMismatch: "No direct participant population for self-experiment translation because this is a review protocol."
interventionOrExposure: "Psyllium fibre interventions in randomized controlled trials with reported amount and isolatable effects."
comparatorOrControl: "Relevant RCT comparators as defined in eligible primary trials."
durationOrFollowUp: "Eligible RCTs required at least 3 weeks of follow-up."
endpoints: "LDL-C, non-HDL-C, and apolipoprotein B in trials with at least 3 weeks follow-up."
effectEstimatesOrDirection: "No effect estimate extracted from the registry/protocol record."
adverseEventsOrSafetyNotes: "No adverse-event extraction in the registry/protocol record."
artifactCandidates:
  - "art-clinicaltrials-gov-nct03346733-2026-04-26"
sourceFindings:
  -
    findingId: "finding:clinicaltrials-gov-nct03346733-psyllium-review-eligibility"
    sourceKey: "source_artifact:clinicaltrials-gov-nct03346733-2026-04-26"
    extractedFromArtifactId: "art-clinicaltrials-gov-nct03346733-2026-04-26"
    findingKind: "context"
    population: "RCT participants in psyllium fibre trials, as planned for review inclusion; trial-level populations were not individually extracted from this registry record."
    exposure: "Psyllium fibre interventions in randomized controlled trials with reported amount and isolatable effects."
    outcome: "LDL-C, non-HDL-C, and apolipoprotein B in trials with at least 3 weeks follow-up."
    summary: "Registered review protocol planned to include psyllium RCTs with reported psyllium amount, isolatable lipid effects, and at least 3 weeks follow-up for LDL-C, non-HDL-C, and apoB outcomes."
    evidenceUse:
      - "context"
      - "measurement"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---
This source is included for **Registries and unpublished protocols**.

**Findings:** Registered review protocol planned to include psyllium RCTs with reported psyllium amount, isolatable lipid effects, and at least 3 weeks follow-up for LDL-C, non-HDL-C, and apoB outcomes.

**Why it matters:** Defines the eligibility and extraction logic behind a modern psyllium lipid meta-analysis, including minimum follow-up and isolatable psyllium effects.

**Potential experiment signals:** LDL-C, non-HDL-C, apolipoprotein B, dose, follow-up duration, risk of bias, GRADE certainty.

**Protocol takeaway:** Use as context for which trial features matter in the protocol synthesis; the registry/protocol record is not itself the meta-analysis result source.

**Claim use:** `context-only`.

**Directness:** `direct_protocol`.

**Population mismatch:** No direct participant population for self-experiment translation because this is a review protocol.

**Limitations:** Protocol/registration source rather than final meta-analysis results.; Registry enrollment figure is an aggregate/protocol estimate, not a primary-trial sample size.; Published meta-analysis results require separate source extraction.

**Safety notes:** No adverse-event extraction in the registry/protocol record.
