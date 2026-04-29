---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct00502047-2026-04-26"
slug: "sources/psyllium-husk/clinicaltrials-gov-nct00502047-2026-04-26"
title: "Effect of the Plantago Ovata Husk on the Lipid Profile of Patients With Hypercholesterolemia"
summary: "ClinicalTrials.gov registry record for Plantago ovata husk in adults with hypercholesterolemia and cardiovascular risk factors, with LDL-C reduction as the primary planned endpoint."
status: "draft"
quality: "usable"
aliases:
  - "NCT00502047"
  - "Plantago ovata lipid-profile trial"
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
  title: "Effect of the Plantago Ovata Husk on the Lipid Profile of Patients With Hypercholesterolemia"
  authors: "Registry sponsor/record holder: Rottapharm Spain"
  year: 2007
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Effect of the Plantago Ovata Husk on the Lipid Profile of Patients With Hypercholesterolemia. NCT00502047. Registry record. Extracted 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT00502047"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT00502047"
    titleHash: "f3e6304b23f74f0431717ec6de0ab93584e79ce0ef307d6acc3a30fdb81d239a"
    url: "https://clinicaltrials.gov/study/NCT00502047"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT00502047"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Completed randomized double-masked parallel trial registry record"
  participantCount: 255
  participantCountKind: "reported"
  populationLabel: "Adults at least 20 years old with LDL-C greater than 130 mg/dL and less than 189 mg/dL plus at least one cardiovascular risk factor; diabetes and established cardiovascular disease were excluded."
  durationLabel: "16 weeks in the registry outcomes."
  aggregateRole: "context"
  cohortKey: "nct00502047"
  notes:
    - "Directness to protocol: direct_protocol."
    - "Population mismatch: Good cholesterol-population match, but trial included risk-factor selection and possible statin-combination phases rather than a simple self-experiment protocol."
    - "Registry page does not provide effect estimates."
    - "Published articles linked to the registry should be extracted as separate source artifacts before claiming results."
    - "Comparator details are not fully available in the extracted registry text."
sourceKind: "trial_registry"
evidenceBucket: "Registries and unpublished protocols"
directness: "direct_protocol"
whyItMatters: "Directly matches the cholesterol target and identifies a 16-week LDL-C endpoint, but registry extraction provides protocol aims rather than outcome results."
potentialMurphEndpoints:
  - "LDL-C change"
  - "therapeutic cholesterol goal attainment with statin combination"
  - "blood pressure"
  - "genotype-effect modulation"
protocolTakeaway: "Use as registry context for an adult hypercholesterolemia Plantago ovata trial; do not cite it as confirming LDL lowering unless a separately extracted publication/result record is used."
murphTakeaway: "Most directly cholesterol-targeted registry in this batch, but still a protocol/registry page without extractable effect estimates."
studyDesign: "Randomized, double-masked, parallel-group interventional trial"
modality: "psyllium husk / Plantago ovata fiber intervention or registry context"
claimUse: "context-only"
limitations:
  - "Registry page does not provide effect estimates."
  - "Published articles linked to the registry should be extracted as separate source artifacts before claiming results."
  - "Comparator details are not fully available in the extracted registry text."
populationMismatch: "Good cholesterol-population match, but trial included risk-factor selection and possible statin-combination phases rather than a simple self-experiment protocol."
interventionOrExposure: "Plantago ovata husk added to a low-saturated-fat diet; registry secondary objectives include combined cholesterol lowering with statins."
comparatorOrControl: "Parallel comparator/control not fully resolved from accessible registry extraction; do not assume placebo from this source page alone."
durationOrFollowUp: "16 weeks in the registry outcomes."
endpoints: "Primary planned endpoint was ability to reduce plasma LDL-C by 5% at 16 weeks; secondary endpoints included combined cholesterol-lowering with statins, blood pressure, and genotype modulation."
effectEstimatesOrDirection: "No registry-extracted effect estimate or direction."
adverseEventsOrSafetyNotes: "No registry-extracted adverse-event results."
artifactCandidates:
  - "art-clinicaltrials-gov-nct00502047-2026-04-26"
sourceFindings:

  -
    findingId: "finding:clinicaltrials-gov-nct00502047-plantago-ovata-ldl-protocol"
    sourceKey: "source_artifact:clinicaltrials-gov-nct00502047-2026-04-26"
    extractedFromArtifactId: "art-clinicaltrials-gov-nct00502047-2026-04-26"
    findingKind: "context"
    population: "Adults at least 20 years old with LDL-C greater than 130 mg/dL and less than 189 mg/dL plus at least one cardiovascular risk factor; diabetes and established cardiovascular disease were excluded."
    exposure: "Plantago ovata husk added to a low-saturated-fat diet; registry secondary objectives include combined cholesterol lowering with statins."
    outcome: "Primary planned endpoint was ability to reduce plasma LDL-C by 5% at 16 weeks; secondary endpoints included combined cholesterol-lowering with statins, blood pressure, and genotype modulation."
    summary: "Registry protocol targeted adults with moderate hypercholesterolemia and planned a 16-week LDL-C reduction endpoint for Plantago ovata husk, but the registry record itself does not report lipid effects."
    evidenceUse:
      - "context"
      - "measurement"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
---
This source is included for **Registries and unpublished protocols**.

**Findings:** Registry protocol targeted adults with moderate hypercholesterolemia and planned a 16-week LDL-C reduction endpoint for Plantago ovata husk, but the registry record itself does not report lipid effects.

**Why it matters:** Directly matches the cholesterol target and identifies a 16-week LDL-C endpoint, but registry extraction provides protocol aims rather than outcome results.

**Potential experiment signals:** LDL-C change, therapeutic cholesterol goal attainment with statin combination, blood pressure, genotype-effect modulation.

**Protocol takeaway:** Use as registry context for an adult hypercholesterolemia Plantago ovata trial; do not cite it as confirming LDL lowering unless a separately extracted publication/result record is used.

**Claim use:** `context-only`.

**Directness:** `direct_protocol`.

**Population mismatch:** Good cholesterol-population match, but trial included risk-factor selection and possible statin-combination phases rather than a simple self-experiment protocol.

**Limitations:** Registry page does not provide effect estimates.; Published articles linked to the registry should be extracted as separate source artifacts before claiming results.; Comparator details are not fully available in the extracted registry text.

**Safety notes:** No registry-extracted adverse-event results.
