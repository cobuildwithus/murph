---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct01582282-2026-04-26"
slug: "sources/psyllium-husk/clinicaltrials-gov-nct01582282-2026-04-26"
title: "Study of Metamucil on Blood Glucose and HbA1c in Type II NIDDM Subjects"
summary: "ClinicalTrials.gov registry record for Metamucil in type II diabetes, with glycemic primary endpoints and lipid secondary endpoints."
status: "draft"
quality: "usable"
aliases:
  - "NCT01582282"
  - "Metamucil NIDDM blood glucose HbA1c trial"
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
  title: "Study of Metamucil on Blood Glucose and HbA1c in Type II NIDDM Subjects"
  authors: "Registry sponsor/record holder: Procter and Gamble"
  year: 2012
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Study of Metamucil on Blood Glucose and HbA1c in Type II NIDDM Subjects. NCT01582282. Registry record. Extracted 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT01582282"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT01582282"
    titleHash: "bbf3f7c3d012af5d76e7f8bafb843e61ab62724ecc5725b944eac31710ed84b6"
    url: "https://clinicaltrials.gov/study/NCT01582282"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT01582282"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Terminated randomized double-blind placebo-controlled parallel trial registry record"
  participantCount: 37
  participantCountKind: "reported"
  populationLabel: "Adults age 36–80 years with type II non-insulin-dependent diabetes mellitus, HbA1c 6–10%, fasting glucose 120–220 mg/dL, and stable low-fiber diet."
  durationLabel: "8-week diet lead-in followed by 12-week treatment."
  aggregateRole: "context"
  cohortKey: "nct01582282"
  notes:
    - "Directness to protocol: adjacent_variant."
    - "Population mismatch: Type II diabetes population rather than non-diabetic adults targeting LDL-C."
    - "Terminated registry record with actual enrollment 37."
    - "Primary aim is glycemic control in type II diabetes."
    - "Lipid effects are secondary and not reported as registry results."
sourceKind: "trial_registry"
evidenceBucket: "Registries and unpublished protocols"
directness: "adjacent_variant"
whyItMatters: "Shows two common psyllium doses timed before breakfast and dinner and includes LDL-C/HDL-C/total cholesterol/TG outcomes, but the trial aim is diabetes/glycemic control."
potentialMurphEndpoints:
  - "fasting glucose"
  - "HbA1c"
  - "LDL-C"
  - "HDL-C"
  - "total cholesterol"
  - "triglycerides"
protocolTakeaway: "Use as adjacent metabolic context for dose and timing; do not promote it into direct cholesterol evidence without the separately extracted results publication."
murphTakeaway: "Helpful for practical dosing ranges and lipid endpoint inclusion, but diabetes population and glycemic primary endpoints limit direct cholesterol interpretation."
studyDesign: "Randomized, double-blind, placebo-controlled parallel trial"
modality: "psyllium husk / Plantago ovata fiber intervention or registry context"
claimUse: "context-only"
limitations:
  - "Terminated registry record with actual enrollment 37."
  - "Primary aim is glycemic control in type II diabetes."
  - "Lipid effects are secondary and not reported as registry results."
populationMismatch: "Type II diabetes population rather than non-diabetic adults targeting LDL-C."
interventionOrExposure: "Metamucil providing 3.4 g psyllium twice daily or 6.8 g psyllium twice daily, immediately or just before breakfast and dinner."
comparatorOrControl: "Fiber-free placebo matched to Metamucil."
durationOrFollowUp: "8-week diet lead-in followed by 12-week treatment."
endpoints: "Fasting glucose and HbA1c primary context; LDL-C, HDL-C, total cholesterol, and triglycerides as 12-week lipid outcomes."
effectEstimatesOrDirection: "No registry-extracted lipid effect estimates."
adverseEventsOrSafetyNotes: "No registry-extracted adverse-event results."
artifactCandidates:
  - "art-clinicaltrials-gov-nct01582282-2026-04-26"
sourceFindings:
  -
    findingId: "finding:clinicaltrials-gov-nct01582282-psy-doses-glycemic-lipid-endpoints"
    sourceKey: "source_artifact:clinicaltrials-gov-nct01582282-2026-04-26"
    extractedFromArtifactId: "art-clinicaltrials-gov-nct01582282-2026-04-26"
    findingKind: "context"
    population: "Adults age 36–80 years with type II non-insulin-dependent diabetes mellitus, HbA1c 6–10%, fasting glucose 120–220 mg/dL, and stable low-fiber diet."
    exposure: "Metamucil providing 3.4 g psyllium twice daily or 6.8 g psyllium twice daily, immediately or just before breakfast and dinner."
    outcome: "Fasting glucose and HbA1c primary context; LDL-C, HDL-C, total cholesterol, and triglycerides as 12-week lipid outcomes."
    summary: "Registry record compared placebo with 6.8 g/day and 13.6 g/day psyllium from Metamucil before breakfast and dinner for 12 weeks in type II diabetes, measuring glycemic and lipid endpoints but reporting no registry effect estimates."
    evidenceUse:
      - "context"
      - "measurement"
      - "adjacent_variant"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Registries and unpublished protocols**.

**Findings:** Registry record compared placebo with 6.8 g/day and 13.6 g/day psyllium from Metamucil before breakfast and dinner for 12 weeks in type II diabetes, measuring glycemic and lipid endpoints but reporting no registry effect estimates.

**Why it matters:** Shows two common psyllium doses timed before breakfast and dinner and includes LDL-C/HDL-C/total cholesterol/TG outcomes, but the trial aim is diabetes/glycemic control.

**Potential experiment signals:** fasting glucose, HbA1c, LDL-C, HDL-C, total cholesterol, triglycerides.

**Protocol takeaway:** Use as adjacent metabolic context for dose and timing; do not promote it into direct cholesterol evidence without the separately extracted results publication.

**Claim use:** `context-only`.

**Directness:** `adjacent_variant`.

**Population mismatch:** Type II diabetes population rather than non-diabetic adults targeting LDL-C.

**Limitations:** Terminated registry record with actual enrollment 37.; Primary aim is glycemic control in type II diabetes.; Lipid effects are secondary and not reported as registry results.

**Safety notes:** No registry-extracted adverse-event results.
