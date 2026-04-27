---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct06188728-2026-04-26"
slug: "sources/psyllium-husk/clinicaltrials-gov-nct06188728-2026-04-26"
title: "Husk Fiber Intervention on Metabolic Health of Centrally Obese School Teachers"
summary: "ClinicalTrials.gov registry record for a husk-fiber/lifestyle trial in centrally obese school teachers, with metabolic-health outcomes and psyllium-like dosing context."
status: "draft"
quality: "usable"
aliases:
  - "NCT06188728"
  - "Husk fiber centrally obese school teachers trial"
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
  title: "Husk Fiber Intervention on Metabolic Health of Centrally Obese School Teachers"
  authors: "Registry sponsor/record holder: University of Peshawar"
  year: 2024
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Husk Fiber Intervention on Metabolic Health of Centrally Obese School Teachers. NCT06188728. Registry record. Extracted 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT06188728"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT06188728"
    titleHash: "c084056a2c346aba49e9777bfb7d9910ca06cd7df6df9c6c3f74eab1e95c1772"
    url: "https://clinicaltrials.gov/study/NCT06188728"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT06188728"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Randomized lifestyle and husk-fiber intervention registry record"
  participantCount: 120
  participantCountKind: "reported"
  populationLabel: "School teachers age 40–60 years with central obesity and without chronic disease exclusions such as diabetes, hypertension, or cardiovascular disease."
  durationLabel: "16 weeks."
  aggregateRole: "context"
  cohortKey: "nct06188728"
  notes:
    - "Directness to protocol: direct_protocol."
    - "Population mismatch: Centrally obese school teachers without chronic disease, not general hypercholesterolemia treatment-seeking adults."
    - "Accessible extraction did not fully verify all endpoint definitions."
    - "Lifestyle cointervention and centrally obese teacher population differ from isolated psyllium use for cholesterol."
    - "No outcome results extracted."
sourceKind: "trial_registry"
evidenceBucket: "Registries and unpublished protocols"
directness: "direct_protocol"
whyItMatters: "Provides recent practical dosing and pre-meal timing context, but exact lipid endpoint wording and dose wording require caution and no outcome results were extracted."
potentialMurphEndpoints:
  - "central obesity measures"
  - "metabolic health"
  - "lipid profile if verified in full registry results"
  - "lifestyle cointervention"
protocolTakeaway: "Use as context for pre-meal husk-fiber implementation and lifestyle cointervention boundaries; do not use for direct LDL-C claims without a full endpoint/result extraction."
murphTakeaway: "Recent completed registry relevant to real-world husk-fiber use, but mixed lifestyle arms and endpoint uncertainty keep it context-only."
studyDesign: "Randomized interventional trial with husk fiber, lifestyle, combined, and control groups"
modality: "psyllium husk / Plantago ovata fiber intervention or registry context"
claimUse: "context-only"
limitations:
  - "Accessible extraction did not fully verify all endpoint definitions."
  - "Lifestyle cointervention and centrally obese teacher population differ from isolated psyllium use for cholesterol."
  - "No outcome results extracted."
populationMismatch: "Centrally obese school teachers without chronic disease, not general hypercholesterolemia treatment-seeking adults."
interventionOrExposure: "Husk fiber reported as 5 g twice daily in swelled form 30 minutes before breakfast and dinner; combined arm also included lifestyle modification."
comparatorOrControl: "Control with no intervention; lifestyle-only and combined lifestyle plus husk-fiber groups."
durationOrFollowUp: "16 weeks."
endpoints: "Metabolic health outcomes; exact lipid-profile endpoints were not fully verified in accessible extraction."
effectEstimatesOrDirection: "No registry-extracted effect estimates."
adverseEventsOrSafetyNotes: "No registry-extracted adverse-event results."
artifactCandidates:
  - "art-clinicaltrials-gov-nct06188728-2026-04-26"
sourceFindings:
  -
    findingId: "finding:clinicaltrials-gov-nct06188728-schoolteacher-husk-dose-context"
    sourceKey: "source_artifact:clinicaltrials-gov-nct06188728-2026-04-26"
    extractedFromArtifactId: "art-clinicaltrials-gov-nct06188728-2026-04-26"
    findingKind: "context"
    population: "School teachers age 40–60 years with central obesity and without chronic disease exclusions such as diabetes, hypertension, or cardiovascular disease."
    exposure: "Husk fiber reported as 5 g twice daily in swelled form 30 minutes before breakfast and dinner; combined arm also included lifestyle modification."
    outcome: "Metabolic health outcomes; exact lipid-profile endpoints were not fully verified in accessible extraction."
    summary: "Recent registry describes 120 centrally obese school teachers allocated to husk-fiber, lifestyle, combined, or control groups for 16 weeks, with 5 g twice daily before breakfast and dinner in the husk-fiber arms and no extracted outcome results."
    evidenceUse:
      - "context"
      - "adjacent_variant"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Registries and unpublished protocols**.

**Findings:** Recent registry describes 120 centrally obese school teachers allocated to husk-fiber, lifestyle, combined, or control groups for 16 weeks, with 5 g twice daily before breakfast and dinner in the husk-fiber arms and no extracted outcome results.

**Why it matters:** Provides recent practical dosing and pre-meal timing context, but exact lipid endpoint wording and dose wording require caution and no outcome results were extracted.

**Potential experiment signals:** central obesity measures, metabolic health, lipid profile if verified in full registry results, lifestyle cointervention.

**Protocol takeaway:** Use as context for pre-meal husk-fiber implementation and lifestyle cointervention boundaries; do not use for direct LDL-C claims without a full endpoint/result extraction.

**Claim use:** `context-only`.

**Directness:** `direct_protocol`.

**Population mismatch:** Centrally obese school teachers without chronic disease, not general hypercholesterolemia treatment-seeking adults.

**Limitations:** Accessible extraction did not fully verify all endpoint definitions.; Lifestyle cointervention and centrally obese teacher population differ from isolated psyllium use for cholesterol.; No outcome results extracted.

**Safety notes:** No registry-extracted adverse-event results.
