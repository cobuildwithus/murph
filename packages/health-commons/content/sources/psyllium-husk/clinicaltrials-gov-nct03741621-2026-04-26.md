---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct03741621-2026-04-26"
slug: "sources/psyllium-husk/clinicaltrials-gov-nct03741621-2026-04-26"
title: "Viscosity Rather Than Quantity of Dietary Fibre Predicts Cholesterol-lowering Effect in Healthy Individuals"
summary: "ClinicalTrials.gov registry record for a viscosity-focused dietary-fibre trial including a psyllium-containing breakfast cereal arm and lipid endpoints in healthy individuals."
status: "draft"
quality: "usable"
aliases:
  - "NCT03741621"
  - "Viscosity dietary fibre cholesterol trial"
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
  title: "Viscosity Rather Than Quantity of Dietary Fibre Predicts Cholesterol-lowering Effect in Healthy Individuals"
  authors: "Registry sponsor/record holder: Unity Health Toronto"
  year: 2018
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Viscosity Rather Than Quantity of Dietary Fibre Predicts Cholesterol-lowering Effect in Healthy Individuals. NCT03741621. Registry record. Extracted 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT03741621"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT03741621"
    titleHash: "c15c0a942c6a4f894c927f5fd666398741f17467c98a901c6214a77ed5af5705"
    url: "https://clinicaltrials.gov/study/NCT03741621"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT03741621"
researchEvidence:
  designKind: "crossover_trial"
  designLabel: "Randomized double-blind cross-over dietary-fibre registry protocol"
  participantCount: 23
  participantCountKind: "reported"
  populationLabel: "Healthy volunteers age 18–70 years."
  durationLabel: "Three 3-week dietary-fibre periods."
  aggregateRole: "context"
  cohortKey: "nct03741621"
  notes:
    - "Directness to protocol: adjacent_variant."
    - "Population mismatch: Healthy individuals; not LDL-lowering treatment-seeking adults."
    - "Healthy population rather than hypercholesterolemic treatment population."
    - "Psyllium provided in a breakfast cereal/food matrix, not isolated husk powder."
    - "No registry-extracted effect estimates."
sourceKind: "trial_registry"
evidenceBucket: "Registries and unpublished protocols"
directness: "adjacent_variant"
whyItMatters: "Supports mechanism-context around viscous fibre and LDL-C, but the intervention is a food/cereal matrix in healthy volunteers rather than psyllium-husk supplementation for cholesterol treatment."
potentialMurphEndpoints:
  - "LDL-C"
  - "total cholesterol"
  - "triglycerides"
  - "HDL-C"
  - "ApoB"
  - "ApoA-1"
protocolTakeaway: "Use as adjacent mechanism/context for fibre viscosity and lipid measurement; do not cite as direct psyllium supplement evidence."
murphTakeaway: "Mechanistically relevant because viscosity is central to soluble-fibre cholesterol lowering, but the cereal/healthy-volunteer design limits direct protocol use."
studyDesign: "Randomized double-blind cross-over trial"
modality: "psyllium husk / Plantago ovata fiber intervention or registry context"
claimUse: "context-only"
limitations:
  - "Healthy population rather than hypercholesterolemic treatment population."
  - "Psyllium provided in a breakfast cereal/food matrix, not isolated husk powder."
  - "No registry-extracted effect estimates."
populationMismatch: "Healthy individuals; not LDL-lowering treatment-seeking adults."
interventionOrExposure: "Dietary-fibre arms included a viscous fibre blend, Kellogg’s Bran Buds with psyllium, and wheat-bran cereal."
comparatorOrControl: "Cross-over comparison among low-, medium-, and high-viscosity fibre cereal/food interventions; no conventional placebo control in extracted registry text."
durationOrFollowUp: "Three 3-week dietary-fibre periods."
endpoints: "LDL-C primary; total cholesterol, triglycerides, HDL-C, ApoB, and ApoA-1 secondary."
effectEstimatesOrDirection: "No registry-extracted effect estimates."
adverseEventsOrSafetyNotes: "No registry-extracted adverse-event results."
artifactCandidates:
  - "art-clinicaltrials-gov-nct03741621-2026-04-26"
sourceFindings:
  -
    findingId: "finding:clinicaltrials-gov-nct03741621-viscosity-cereal-lipid-endpoints"
    sourceKey: "source_artifact:clinicaltrials-gov-nct03741621-2026-04-26"
    extractedFromArtifactId: "art-clinicaltrials-gov-nct03741621-2026-04-26"
    findingKind: "mechanistic"
    population: "Healthy volunteers age 18–70 years."
    exposure: "Dietary-fibre arms included a viscous fibre blend, Kellogg’s Bran Buds with psyllium, and wheat-bran cereal."
    outcome: "LDL-C primary; total cholesterol, triglycerides, HDL-C, ApoB, and ApoA-1 secondary."
    summary: "Registry protocol compared fibre interventions of different viscosity, including a psyllium-containing cereal arm, in healthy volunteers with LDL-C and apolipoprotein endpoints, but no registry results were extracted."
    evidenceUse:
      - "mechanism"
      - "context"
      - "measurement"
      - "adjacent_variant"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Registries and unpublished protocols**.

**Findings:** Registry protocol compared fibre interventions of different viscosity, including a psyllium-containing cereal arm, in healthy volunteers with LDL-C and apolipoprotein endpoints, but no registry results were extracted.

**Why it matters:** Supports mechanism-context around viscous fibre and LDL-C, but the intervention is a food/cereal matrix in healthy volunteers rather than psyllium-husk supplementation for cholesterol treatment.

**Potential experiment signals:** LDL-C, total cholesterol, triglycerides, HDL-C, ApoB, ApoA-1.

**Protocol takeaway:** Use as adjacent mechanism/context for fibre viscosity and lipid measurement; do not cite as direct psyllium supplement evidence.

**Claim use:** `context-only`.

**Directness:** `adjacent_variant`.

**Population mismatch:** Healthy individuals; not LDL-lowering treatment-seeking adults.

**Limitations:** Healthy population rather than hypercholesterolemic treatment population.; Psyllium provided in a breakfast cereal/food matrix, not isolated husk powder.; No registry-extracted effect estimates.

**Safety notes:** No registry-extracted adverse-event results.
