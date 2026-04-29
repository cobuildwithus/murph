---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct05825963-2026-04-26"
slug: "sources/psyllium-husk/clinicaltrials-gov-nct05825963-2026-04-26"
title: "Psyllium-enriched Hamburger Meatballs: Effects on Postprandial Lipidemia, Glycemia, Appetite and Food Intake"
summary: "ClinicalTrials.gov registry record for an acute food-matrix trial of psyllium-enriched hamburger meatballs and postprandial lipidemia/glycemia."
status: "draft"
quality: "usable"
aliases:
  - "NCT05825963"
  - "Psyllium-enriched hamburger meatball postprandial trial"
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
  title: "Psyllium-enriched Hamburger Meatballs: Effects on Postprandial Lipidemia, Glycemia, Appetite and Food Intake"
  authors: "Registry sponsor/record holder: Ahmet Murat Günal"
  year: 2022
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Psyllium-enriched Hamburger Meatballs: Effects on Postprandial Lipidemia, Glycemia, Appetite and Food Intake. NCT05825963. Registry record. Extracted 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT05825963"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT05825963"
    titleHash: "a6ee89502590eb37f68a36053ae96f24f3d0bd10b28234a413374509295e6b78"
    url: "https://clinicaltrials.gov/study/NCT05825963"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT05825963"
researchEvidence:
  designKind: "acute_mechanistic"
  designLabel: "Randomized quadruple-blind acute cross-over food-matrix registry protocol"
  participantCount: 28
  participantCountKind: "reported"
  populationLabel: "Healthy adults age 19–35 years with BMI 18.5–25 kg/m² and without dyslipidemia or metabolic disease."
  durationLabel: "Single-meal postprandial testing with a 2-week washout between meal sequences; 2-hour postprandial sample window in extracted protocol text."
  aggregateRole: "context"
  cohortKey: "nct05825963"
  notes:
    - "Directness to protocol: adjacent_variant."
    - "Population mismatch: Healthy young adults and acute postprandial setting; not chronic LDL-C treatment population."
    - "Healthy young adults."
    - "Single-meal/acute physiology design."
    - "Psyllium embedded in hamburger meatballs rather than as a supplement."
    - "No registry-extracted outcomes."
sourceKind: "trial_registry"
evidenceBucket: "Registries and unpublished protocols"
directness: "adjacent_variant"
whyItMatters: "Relevant to food-matrix and acute postprandial lipid physiology, but not a chronic cholesterol-lowering supplementation protocol."
potentialMurphEndpoints:
  - "postprandial lipid profile"
  - "postprandial glycemia"
  - "satiety/hunger"
  - "daily food intake"
protocolTakeaway: "Use only as acute food-matrix boundary evidence; do not cite for fasting LDL-C lowering or daily psyllium supplementation effects."
murphTakeaway: "Useful boundary source showing psyllium can be studied in foods and postprandial windows, not a basis for cholesterol-lowering protocol claims."
studyDesign: "Randomized cross-over acute postprandial physiology trial"
modality: "psyllium husk / Plantago ovata fiber intervention or registry context"
claimUse: "context-only"
limitations:
  - "Healthy young adults."
  - "Single-meal/acute physiology design."
  - "Psyllium embedded in hamburger meatballs rather than as a supplement."
  - "No registry-extracted outcomes."
populationMismatch: "Healthy young adults and acute postprandial setting; not chronic LDL-C treatment population."
interventionOrExposure: "Hamburger meatballs enriched with 12 g psyllium, consumed with 200 mL water after fasting."
comparatorOrControl: "Classic hamburger meatballs without psyllium in a cross-over sequence."
durationOrFollowUp: "Single-meal postprandial testing with a 2-week washout between meal sequences; 2-hour postprandial sample window in extracted protocol text."
endpoints: "Postprandial lipid profile, glycemia, appetite/satiety, and food intake."
effectEstimatesOrDirection: "No registry-extracted effect estimates."
adverseEventsOrSafetyNotes: "Eligibility excluded dyslipidemia, chronic/metabolic disease, and lipid-lowering medication; no adverse-event results extracted."
artifactCandidates:
  - "art-clinicaltrials-gov-nct05825963-2026-04-26"
sourceFindings:

  -
    findingId: "finding:clinicaltrials-gov-nct05825963-acute-meatball-postprandial-lipids"
    sourceKey: "source_artifact:clinicaltrials-gov-nct05825963-2026-04-26"
    extractedFromArtifactId: "art-clinicaltrials-gov-nct05825963-2026-04-26"
    findingKind: "context"
    population: "Healthy adults age 19–35 years with BMI 18.5–25 kg/m² and without dyslipidemia or metabolic disease."
    exposure: "Hamburger meatballs enriched with 12 g psyllium, consumed with 200 mL water after fasting."
    outcome: "Postprandial lipid profile, glycemia, appetite/satiety, and food intake."
    summary: "Registry protocol tested a single psyllium-enriched meatball meal containing 12 g psyllium against a classic meatball meal in healthy young adults, measuring acute postprandial lipid and glycemic responses rather than chronic LDL-C lowering."
    evidenceUse:
      - "context"
      - "measurement"
      - "adjacent_variant"
murphV1Priority: "Low"
pdfRightsStatus: "unknown"
---
This source is included for **Registries and unpublished protocols**.

**Findings:** Registry protocol tested a single psyllium-enriched meatball meal containing 12 g psyllium against a classic meatball meal in healthy young adults, measuring acute postprandial lipid and glycemic responses rather than chronic LDL-C lowering.

**Why it matters:** Relevant to food-matrix and acute postprandial lipid physiology, but not a chronic cholesterol-lowering supplementation protocol.

**Potential experiment signals:** postprandial lipid profile, postprandial glycemia, satiety/hunger, daily food intake.

**Protocol takeaway:** Use only as acute food-matrix boundary evidence; do not cite for fasting LDL-C lowering or daily psyllium supplementation effects.

**Claim use:** `context-only`.

**Directness:** `adjacent_variant`.

**Population mismatch:** Healthy young adults and acute postprandial setting; not chronic LDL-C treatment population.

**Limitations:** Healthy young adults.; Single-meal/acute physiology design.; Psyllium embedded in hamburger meatballs rather than as a supplement.; No registry-extracted outcomes.

**Safety notes:** Eligibility excluded dyslipidemia, chronic/metabolic disease, and lipid-lowering medication; no adverse-event results extracted.
