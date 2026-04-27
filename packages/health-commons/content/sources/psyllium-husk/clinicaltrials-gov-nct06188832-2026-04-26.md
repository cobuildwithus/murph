---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct06188832-2026-04-26"
slug: "sources/psyllium-husk/clinicaltrials-gov-nct06188832-2026-04-26"
title: "Efficacy of Dietary Fiber Supplementation (Soloways) in Patients With Specific Genetic Polymorphisms"
summary: "ClinicalTrials.gov registry record for a combination-fiber supplement containing psyllium, glucomannan, and inulin in genetically selected overweight/obese adults."
status: "draft"
quality: "usable"
aliases:
  - "NCT06188832"
  - "SOLFIBERGP"
  - "Soloways dietary fiber polymorphism trial"
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
  title: "Efficacy of Dietary Fiber Supplementation (Soloways) in Patients With Specific Genetic Polymorphisms"
  authors: "Registry sponsor/record holder: S.LAB (SOLOWAYS)"
  year: 2024
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Efficacy of Dietary Fiber Supplementation (Soloways) in Patients With Specific Genetic Polymorphisms. NCT06188832. Registry record. Extracted 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT06188832"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT06188832"
    titleHash: "9e8e42ff182405af8764ab11f3d4dfb131a8bb3d4b2814585138be7a720c7124"
    url: "https://clinicaltrials.gov/study/NCT06188832"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT06188832"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Randomized double-blind placebo-controlled parallel trial registry record"
  participantCount: 108
  participantCountKind: "reported"
  populationLabel: "Adults age 18–65 years with overweight/obesity and confirmed FTO, MC4R, LEP, or LEPR polymorphisms."
  durationLabel: "12 weeks, with checks every 4 weeks in the registry summary."
  aggregateRole: "context"
  cohortKey: "nct06188832"
  notes:
    - "Directness to protocol: adjacent_variant."
    - "Population mismatch: Overweight/obese adults with specific genetic polymorphisms; not a general LDL-lowering psyllium-only protocol."
    - "Combination product contains glucomannan, inulin, and psyllium."
    - "Participant count conflict in accessible registry mirror: protocol section reported 108 while summary wording referenced 216."
    - "Genotype-selected overweight/obese population."
sourceKind: "trial_registry"
evidenceBucket: "Registries and unpublished protocols"
directness: "adjacent_variant"
whyItMatters: "Includes lipid outcomes and side-effect monitoring, but psyllium is not isolated and the registry mirror contained conflicting participant-count wording."
potentialMurphEndpoints:
  - "weight change"
  - "LDL-C ratio"
  - "total cholesterol ratio"
  - "HDL-C ratio"
  - "triglyceride ratio"
  - "hs-CRP"
  - "fasting glucose"
  - "side effects"
protocolTakeaway: "Use as adjacent combination-fiber context only; do not attribute outcomes to psyllium alone."
murphTakeaway: "Useful boundary source for modern multi-fiber products and side-effect capture, not for isolated psyllium efficacy."
studyDesign: "Randomized, placebo-controlled, double-blind parallel trial"
modality: "psyllium husk / Plantago ovata fiber intervention or registry context"
claimUse: "context-only"
limitations:
  - "Combination product contains glucomannan, inulin, and psyllium."
  - "Participant count conflict in accessible registry mirror: protocol section reported 108 while summary wording referenced 216."
  - "Genotype-selected overweight/obese population."
populationMismatch: "Overweight/obese adults with specific genetic polymorphisms; not a general LDL-lowering psyllium-only protocol."
interventionOrExposure: "Active powder per bag included 1 g glucomannan, 1 g inulin, and 3 g psyllium."
comparatorOrControl: "Placebo powder containing maltodextrin and rice flour."
durationOrFollowUp: "12 weeks, with checks every 4 weeks in the registry summary."
endpoints: "Primary body-weight change; secondary lipid ratios, hs-CRP, fasting glucose, side effects, blood pressure, and body composition."
effectEstimatesOrDirection: "No registry-extracted effect estimates."
adverseEventsOrSafetyNotes: "Side effects were listed as a secondary outcome, but no results were extracted from the registry record."
artifactCandidates:
  - "art-clinicaltrials-gov-nct06188832-2026-04-26"
sourceFindings:
  -
    findingId: "finding:clinicaltrials-gov-nct06188832-soloways-combination-fiber-lipid-outcomes"
    sourceKey: "source_artifact:clinicaltrials-gov-nct06188832-2026-04-26"
    extractedFromArtifactId: "art-clinicaltrials-gov-nct06188832-2026-04-26"
    findingKind: "context"
    population: "Adults age 18–65 years with overweight/obesity and confirmed FTO, MC4R, LEP, or LEPR polymorphisms."
    exposure: "Active powder per bag included 1 g glucomannan, 1 g inulin, and 3 g psyllium."
    outcome: "Primary body-weight change; secondary lipid ratios, hs-CRP, fasting glucose, side effects, blood pressure, and body composition."
    summary: "Registry protocol tested a combination fiber product containing 3 g psyllium plus glucomannan and inulin per bag against placebo for 12 weeks, with lipid ratios and side effects as secondary outcomes; no outcome results were extracted."
    evidenceUse:
      - "context"
      - "adjacent_variant"
      - "safety"
      - "measurement"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Registries and unpublished protocols**.

**Findings:** Registry protocol tested a combination fiber product containing 3 g psyllium plus glucomannan and inulin per bag against placebo for 12 weeks, with lipid ratios and side effects as secondary outcomes; no outcome results were extracted.

**Why it matters:** Includes lipid outcomes and side-effect monitoring, but psyllium is not isolated and the registry mirror contained conflicting participant-count wording.

**Potential experiment signals:** weight change, LDL-C ratio, total cholesterol ratio, HDL-C ratio, triglyceride ratio, hs-CRP, fasting glucose, side effects.

**Protocol takeaway:** Use as adjacent combination-fiber context only; do not attribute outcomes to psyllium alone.

**Claim use:** `context-only`.

**Directness:** `adjacent_variant`.

**Population mismatch:** Overweight/obese adults with specific genetic polymorphisms; not a general LDL-lowering psyllium-only protocol.

**Limitations:** Combination product contains glucomannan, inulin, and psyllium.; Participant count conflict in accessible registry mirror: protocol section reported 108 while summary wording referenced 216.; Genotype-selected overweight/obese population.

**Safety notes:** Side effects were listed as a secondary outcome, but no results were extracted from the registry record.
