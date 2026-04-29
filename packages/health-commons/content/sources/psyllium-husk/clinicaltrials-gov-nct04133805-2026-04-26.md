---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct04133805-2026-04-26"
slug: "sources/psyllium-husk/clinicaltrials-gov-nct04133805-2026-04-26"
title: "The Effect of Viscous Dietary Fibers on LDL-cholesterol"
summary: "ClinicalTrials.gov registry/protocol record for a multi-fiber systematic review of viscous dietary fibers and LDL-C, including psyllium among eligible fibers."
status: "draft"
quality: "usable"
aliases:
  - "NCT04133805"
  - "Viscous dietary fibers LDL-cholesterol review protocol"
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
  title: "The Effect of Viscous Dietary Fibers on LDL-cholesterol"
  authors: "Registry sponsor/record holder: Unity Health Toronto"
  year: 2019
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. The Effect of Viscous Dietary Fibers on LDL-cholesterol. NCT04133805. Registry record. Extracted 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT04133805"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT04133805"
    titleHash: "f8060be40b5ab2ec7be6dbdf372fec7276eb7e173dbeb7791fb59378908968f2"
    url: "https://clinicaltrials.gov/study/NCT04133805"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT04133805"
researchEvidence:
  designKind: "meta_analysis"
  designLabel: "Registered systematic review and meta-analysis protocol for viscous dietary fibers"
  participantCount: 7845
  participantCountKind: "reported"
  populationLabel: "Adults with or without hypercholesterolemia in RCTs of viscous dietary fibers."
  durationLabel: "Eligible RCTs required at least 3 weeks of follow-up."
  aggregateRole: "synthesis"
  cohortKey: "nct04133805"
  notes:
    - "Directness to protocol: adjacent_variant."
    - "Population mismatch: Broad adult RCT populations and multiple fiber interventions rather than a single psyllium-husk protocol."
    - "Multi-fiber synthesis rather than psyllium-only."
    - "Protocol/registry source rather than extracted result article."
    - "Includes several fiber types with potentially different effects."
sourceKind: "trial_registry"
evidenceBucket: "Registries and unpublished protocols"
directness: "adjacent_variant"
whyItMatters: "Useful same-mechanism context for viscous soluble-fibre lipid lowering, while not psyllium-only."
potentialMurphEndpoints:
  - "LDL-C"
  - "non-HDL-C"
  - "apolipoprotein B"
  - "fiber type"
  - "fiber dose"
  - "trial duration"
protocolTakeaway: "Use as adjacent class-level context for viscous fiber mechanisms and endpoints; do not substitute it for psyllium-specific evidence."
murphTakeaway: "Good for mechanism-class framing; too broad for direct psyllium-only protocol claims."
studyDesign: "Systematic review and meta-analysis protocol"
modality: "psyllium husk / Plantago ovata fiber intervention or registry context"
claimUse: "context-only"
limitations:
  - "Multi-fiber synthesis rather than psyllium-only."
  - "Protocol/registry source rather than extracted result article."
  - "Includes several fiber types with potentially different effects."
populationMismatch: "Broad adult RCT populations and multiple fiber interventions rather than a single psyllium-husk protocol."
interventionOrExposure: "Eligible fibers included barley/oat beta-glucan, konjac glucomannan, psyllium, guar gum, and pectin."
comparatorOrControl: "Controls in eligible RCTs; combination supplements and whole-food interventions without isolatable soluble fiber amount were excluded."
durationOrFollowUp: "Eligible RCTs required at least 3 weeks of follow-up."
endpoints: "LDL-C primary; non-HDL-C and ApoB secondary."
effectEstimatesOrDirection: "No effect estimate extracted from the registry/protocol record."
adverseEventsOrSafetyNotes: "No adverse-event extraction in the registry/protocol record."
artifactCandidates:
  - "art-clinicaltrials-gov-nct04133805-2026-04-26"
sourceFindings:

  -
    findingId: "finding:clinicaltrials-gov-nct04133805-viscous-fiber-review-protocol"
    sourceKey: "source_artifact:clinicaltrials-gov-nct04133805-2026-04-26"
    extractedFromArtifactId: "art-clinicaltrials-gov-nct04133805-2026-04-26"
    findingKind: "mechanistic"
    population: "Adults with or without hypercholesterolemia in RCTs of viscous dietary fibers."
    exposure: "Eligible fibers included barley/oat beta-glucan, konjac glucomannan, psyllium, guar gum, and pectin."
    outcome: "LDL-C primary; non-HDL-C and ApoB secondary."
    summary: "Registered review protocol included RCTs of viscous dietary fibers such as psyllium, beta-glucan, glucomannan, guar gum, and pectin for LDL-C, non-HDL-C, and apoB endpoints over at least 3 weeks."
    evidenceUse:
      - "mechanism"
      - "context"
      - "measurement"
      - "adjacent_variant"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Registries and unpublished protocols**.

**Findings:** Registered review protocol included RCTs of viscous dietary fibers such as psyllium, beta-glucan, glucomannan, guar gum, and pectin for LDL-C, non-HDL-C, and apoB endpoints over at least 3 weeks.

**Why it matters:** Useful same-mechanism context for viscous soluble-fibre lipid lowering, while not psyllium-only.

**Potential experiment signals:** LDL-C, non-HDL-C, apolipoprotein B, fiber type, fiber dose, trial duration.

**Protocol takeaway:** Use as adjacent class-level context for viscous fiber mechanisms and endpoints; do not substitute it for psyllium-specific evidence.

**Claim use:** `context-only`.

**Directness:** `adjacent_variant`.

**Population mismatch:** Broad adult RCT populations and multiple fiber interventions rather than a single psyllium-husk protocol.

**Limitations:** Multi-fiber synthesis rather than psyllium-only.; Protocol/registry source rather than extracted result article.; Includes several fiber types with potentially different effects.

**Safety notes:** No adverse-event extraction in the registry/protocol record.
