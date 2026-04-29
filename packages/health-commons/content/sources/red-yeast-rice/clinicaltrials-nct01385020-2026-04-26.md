---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-nct01385020-2026-04-26"
slug: "sources/red-yeast-rice/clinicaltrials-nct01385020-2026-04-26"
title: "Effect of Gemfibrozil on the Safety and Pharmacokinetics of Red Yeast Rice in Healthy Volunteers"
summary: "ClinicalTrials.gov registry for a RYR-gemfibrozil pharmacokinetic/safety interaction study in healthy volunteers."
status: "draft"
quality: "usable"
aliases:
  - "NCT01385020"
  - "Gemfibrozil red yeast rice pharmacokinetic interaction registry"
categories:
  - "red-yeast-rice"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "other"
  title: "Effect of Gemfibrozil on the Safety and Pharmacokinetics of Red Yeast Rice in Healthy Volunteers"
  authors: "ClinicalTrials.gov; National Taiwan University Hospital"
  year: 2026
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Effect of Gemfibrozil on the Safety and Pharmacokinetics of Red Yeast Rice in Healthy Volunteers. NCT01385020. Snapshot source key dated 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT01385020"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT01385020"
    titleHash: "fa371ac576363eb33dfffcc0aea5c85270ab7ecf6ae03221b6718c0ff044839e"
    url: "https://clinicaltrials.gov/study/NCT01385020"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT01385020"
researchEvidence:
  designKind: "crossover_trial"
  designLabel: "Completed randomized crossover pharmacokinetic interaction registry"
  participantCount: 12
  participantCountKind: "approximate"
  populationLabel: "Healthy adult volunteers."
  durationLabel: "Approximately 1 week pharmacokinetic/safety follow-up in registry extraction notes"
  aggregateRole: "context"
  cohortKey: "clinicaltrials-nct01385020-2026-04-26"
evidenceBucket: "Direct trial registry and future evidence watchlist"
whyItMatters: "Defines an interaction boundary because RYR contains lovastatin-like monacolins and may interact with fibrates or other drugs."
potentialMurphEndpoints:
  - "lovastatin pharmacokinetics"
  - "lovastatin acid pharmacokinetics"
  - "CK"
  - "CoQ10"
protocolTakeaway: "Use only for interaction and clinician-guidance boundaries, not efficacy claims."
murphTakeaway: "Users on gemfibrozil/fibrates or interacting drugs should not self-experiment without clinician guidance."
studyDesign: "Randomized crossover pharmacokinetic trial registry"
modality: "RYR-drug interaction registry"
claimUse: "safety-only"
directness: "safety_boundary"
interventionOrExposure: "LipoCol red yeast rice with and without gemfibrozil dosing."
comparatorOrControl: "Within-participant pharmacokinetic comparison of RYR exposure with gemfibrozil interaction condition."
durationOrFollowUp: "Approximately 1 week pharmacokinetic/safety follow-up in registry extraction notes"
endpoints:
  - "lovastatin pharmacokinetics"
  - "lovastatin acid pharmacokinetics"
  - "CK"
  - "CoQ10"
effectEstimatesOrDirection: "Registry is safety/pharmacokinetic context, not cholesterol efficacy evidence."
adverseEventsOrSafetyNotes: "Related extraction notes indicate concern that gemfibrozil can increase lovastatin acid exposure from RYR products; caution with interacting drugs is warranted."
limitations: "Healthy-volunteer PK study; registry result details were not fully extracted; not a lipid-lowering efficacy study."
populationMismatch: "Healthy volunteers and drug-interaction exposure, not hypercholesterolemic protocol users."
sourceFindings:

  -
    findingId: "finding:clinicaltrials-nct01385020-2026-04-26-interaction-registry"
    sourceKey: "source_artifact:clinicaltrials-nct01385020-2026-04-26"
    findingKind: "safety"
    population: "Healthy adult volunteers."
    exposure: "LipoCol red yeast rice with and without gemfibrozil dosing."
    outcome: "Lovastatin/lovastatin acid pharmacokinetics with gemfibrozil"
    summary: "NCT01385020 is a healthy-volunteer crossover registry evaluating RYR pharmacokinetics and safety with gemfibrozil; endpoints include lovastatin/lovastatin acid pharmacokinetics, CK, and CoQ10."
    evidenceUse:
      - "safety"
      - "context"
  -
    findingId: "finding:clinicaltrials-nct01385020-2026-04-26-efficacy-boundary"
    sourceKey: "source_artifact:clinicaltrials-nct01385020-2026-04-26"
    findingKind: "context"
    population: "Healthy adult volunteers."
    exposure: "LipoCol red yeast rice with and without gemfibrozil dosing."
    outcome: "Not lipid efficacy evidence"
    summary: "This registry is a pharmacokinetic interaction study and should not be used for cholesterol-lowering efficacy."
    evidenceUse:
      - "context"
murphV1Priority: "Low"
pdfRightsStatus: "unknown"
---
This source is included for **Direct trial registry and future evidence watchlist**.

**Findings:** Registry is safety/pharmacokinetic context, not cholesterol efficacy evidence. Related extraction notes indicate concern that gemfibrozil can increase lovastatin acid exposure from RYR products; caution with interacting drugs is warranted.

**Why it matters:** Defines an interaction boundary because RYR contains lovastatin-like monacolins and may interact with fibrates or other drugs.

**Potential experiment signals:** lovastatin pharmacokinetics, lovastatin acid pharmacokinetics, CK, CoQ10.

**Protocol takeaway:** Use only for interaction and clinician-guidance boundaries, not efficacy claims.

**Claim use:** `safety-only`.

**Directness and boundary:** safety_boundary. Healthy-volunteer PK study; registry result details were not fully extracted; not a lipid-lowering efficacy study. Population mismatch: Healthy volunteers and drug-interaction exposure, not hypercholesterolemic protocol users.
