---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct01251991-2026-04-26"
slug: "sources/psyllium-husk/clinicaltrials-gov-nct01251991-2026-04-26"
title: "Cholesterol Lowering Treatment With Psyllium Husks and Isolated Soy Protein in Hypercholesterolemia (ProFi)"
summary: "ClinicalTrials.gov registry record for the ProFi hypercholesterolemia cross-over trial testing additive LDL effects of psyllium husks and isolated soy protein."
status: "draft"
quality: "usable"
aliases:
  - "NCT01251991"
  - "ProFi psyllium soy hypercholesterolemia trial"
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
  title: "Cholesterol Lowering Treatment With Psyllium Husks and Isolated Soy Protein in Hypercholesterolemia (ProFi)"
  authors: "Registry sponsor/record holder: Aalborg University Hospital"
  year: 2011
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Cholesterol Lowering Treatment With Psyllium Husks and Isolated Soy Protein in Hypercholesterolemia (ProFi). NCT01251991. Registry record. Extracted 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT01251991"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT01251991"
    titleHash: "d227ed1fcd2b0824a4d4de11309d2d6c44226edc1d32c22b8ed576aa724b33b4"
    url: "https://clinicaltrials.gov/study/NCT01251991"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT01251991"
researchEvidence:
  designKind: "crossover_trial"
  designLabel: "Randomized cross-over placebo-controlled quadruple-blind registry protocol"
  participantCount: 41
  participantCountKind: "reported"
  populationLabel: "Adults age 18–75 years with hypercholesterolemia, BMI 18.5–35 kg/m², and LDL-C above 3.5 mmol/L."
  durationLabel: "6-week intervention periods in the planned outcome windows."
  aggregateRole: "context"
  cohortKey: "nct01251991"
  notes:
    - "Directness to protocol: direct_protocol."
    - "Population mismatch: Hypercholesterolemia population is relevant, but the combination-factorial intervention differs from a simple psyllium-husk protocol."
    - "Registry/protocol source without extracted results."
    - "Intervention combinations include soy/whey/cellulose, so isolated psyllium effects require careful arm-specific analysis."
    - "Publication linkage was not resolved in the source ledger batch."
sourceKind: "trial_registry"
evidenceBucket: "Registries and unpublished protocols"
directness: "direct_protocol"
whyItMatters: "Directly addresses LDL-C in hypercholesterolemia and includes arms that can separate psyllium and soy components, but no registry outcome results were extracted."
potentialMurphEndpoints:
  - "LDL-C at 6 weeks"
  - "total cholesterol"
  - "HDL-C"
  - "triglycerides"
  - "apolipoprotein B"
  - "small dense LDL"
  - "hs-CRP"
  - "fasting glucose"
  - "body weight"
protocolTakeaway: "Use as registry context for short-term LDL endpoint design and factorial comparator logic; do not treat as isolated psyllium efficacy evidence until results are extracted."
murphTakeaway: "Strong design context for LDL-C endpoints, but the soy/whey/cellulose factorial design makes it a protocol-context source rather than a direct claim source."
studyDesign: "Randomized, placebo-controlled, quadruple-blind cross-over trial"
modality: "psyllium husk / Plantago ovata fiber intervention or registry context"
claimUse: "context-only"
limitations:
  - "Registry/protocol source without extracted results."
  - "Intervention combinations include soy/whey/cellulose, so isolated psyllium effects require careful arm-specific analysis."
  - "Publication linkage was not resolved in the source ledger batch."
populationMismatch: "Hypercholesterolemia population is relevant, but the combination-factorial intervention differs from a simple psyllium-husk protocol."
interventionOrExposure: "Psyllium husks combined with soy or whey protein in cross-over arms."
comparatorOrControl: "Arms included soy with microcrystalline cellulose and whey with microcrystalline cellulose as comparator combinations."
durationOrFollowUp: "6-week intervention periods in the planned outcome windows."
endpoints: "Primary planned endpoint: change in LDL-C at 6 weeks; secondary endpoints included total cholesterol, HDL-C, triglycerides, fasting glucose, body weight, apoB, small dense LDL, and hs-CRP."
effectEstimatesOrDirection: "No registry-extracted effect estimate or direction."
adverseEventsOrSafetyNotes: "No registry-extracted adverse-event results."
artifactCandidates:
  - "art-clinicaltrials-gov-nct01251991-2026-04-26"
sourceFindings:
  -
    findingId: "finding:clinicaltrials-gov-nct01251991-additive-psyllium-soy-ldl-protocol"
    sourceKey: "source_artifact:clinicaltrials-gov-nct01251991-2026-04-26"
    extractedFromArtifactId: "art-clinicaltrials-gov-nct01251991-2026-04-26"
    findingKind: "context"
    population: "Adults age 18–75 years with hypercholesterolemia, BMI 18.5–35 kg/m², and LDL-C above 3.5 mmol/L."
    exposure: "Psyllium husks combined with soy or whey protein in cross-over arms."
    outcome: "Primary planned endpoint: change in LDL-C at 6 weeks; secondary endpoints included total cholesterol, HDL-C, triglycerides, fasting glucose, body weight, apoB, small dense LDL, and hs-CRP."
    summary: "Registry protocol planned a cross-over hypercholesterolemia study with psyllium/soy/whey/cellulose combinations and LDL-C as the 6-week primary endpoint, but no outcome effects were extracted from the registry record."
    evidenceUse:
      - "context"
      - "measurement"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
---
This source is included for **Registries and unpublished protocols**.

**Findings:** Registry protocol planned a cross-over hypercholesterolemia study with psyllium/soy/whey/cellulose combinations and LDL-C as the 6-week primary endpoint, but no outcome effects were extracted from the registry record.

**Why it matters:** Directly addresses LDL-C in hypercholesterolemia and includes arms that can separate psyllium and soy components, but no registry outcome results were extracted.

**Potential experiment signals:** LDL-C at 6 weeks, total cholesterol, HDL-C, triglycerides, apolipoprotein B, small dense LDL, hs-CRP, fasting glucose, body weight.

**Protocol takeaway:** Use as registry context for short-term LDL endpoint design and factorial comparator logic; do not treat as isolated psyllium efficacy evidence until results are extracted.

**Claim use:** `context-only`.

**Directness:** `direct_protocol`.

**Population mismatch:** Hypercholesterolemia population is relevant, but the combination-factorial intervention differs from a simple psyllium-husk protocol.

**Limitations:** Registry/protocol source without extracted results.; Intervention combinations include soy/whey/cellulose, so isolated psyllium effects require careful arm-specific analysis.; Publication linkage was not resolved in the source ledger batch.

**Safety notes:** No registry-extracted adverse-event results.
