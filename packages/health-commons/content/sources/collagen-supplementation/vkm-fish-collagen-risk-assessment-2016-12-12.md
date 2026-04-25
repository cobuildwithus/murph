---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:vkm-fish-collagen-risk-assessment-2016-12-12
slug: sources/collagen-supplementation/vkm-fish-collagen-risk-assessment-2016-12-12
title: Risk assessment of "other substances" – Collagen from fish skin
summary: VKM assessed 750 mg/day fish-skin collagen and found adverse effects unlikely for ages 10+, while flagging fish-allergy vulnerability and major data gaps.
status: draft
quality: usable
aliases:
- Risk assessment of "other substances" – Collagen from fish skin
categories:
- collagen-supplementation
- safety-quality-contaminants
- adjacent_variant
- safety-only
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: https://vkm.no/download/18.645b840415d03a2fe8f25cb3/1499326499108/d671b34aa6.pdf
  canonicalUrl: https://vkm.no/download/18.645b840415d03a2fe8f25cb3/1499326499108/d671b34aa6.pdf
  identityAliases:
  - Risk assessment of "other substances" – Collagen from fish skin
source:
  kind: guideline
  title: Risk assessment of "other substances" – Collagen from fish skin
  authors: Norwegian Scientific Committee for Food Safety (VKM), Panel on Food Additives, Flavourings, Processing Aids, Materials in Contact with Food and Cosmetics
  citation: VKM. Risk assessment of "other substances" – Collagen from fish skin. Opinion of the Panel Food Additives, Flavourings, Processing Aids, Materials in Contact with Food and Cosmetics of the Norwegian Scientific Committee for Food Safety. VKM Report 2016:65. 2016.
  year: 2016
  journal: VKM Report 2016:65
  url: https://vkm.no/download/18.645b840415d03a2fe8f25cb3/1499326499108/d671b34aa6.pdf
researchEvidence:
  designKind: other
  designLabel: Regulatory risk assessment of collagen from fish skin in food supplements
  populationLabel: General population aged 10 years and above, assessed using default body weights for children, adolescents, and adults
  durationLabel: Risk assessment of 750 mg/day intake; no clinical follow-up
  cohortKey: batch-009:vkm-fish-collagen-risk-assessment-2016-12-12
  aggregateRole: primary
evidenceBucket: safety-quality-contaminants
whyItMatters: Regulatory fish-collagen risk assessment with explicit dose, allergy, and uncertainty boundaries.
potentialMurphEndpoints:
- safety:fish-skin-collagen
- safety:margin-of-exposure
- safety:fish-allergy
- limitation:human-data-gap
protocolTakeaway: Use source_artifact:vkm-fish-collagen-risk-assessment-2016-12-12 as fish-skin collagen regulatory risk-assessment context only.
murphTakeaway: 'Useful for dose-boundary and allergy caveats: fish-derived collagen may be acceptable for many, but not automatically for fish-allergic users.'
studyDesign: Regulatory risk assessment of collagen from fish skin in food supplements
modality: regulatory risk assessment of fish-skin collagen supplement dose
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: safety-quality-contaminants
  directness: adjacent_variant
  claimUse: safety-only
  priority: high
  batchId: batch-009
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **safety-quality-contaminants**.

**Findings:** Population/exposure: General population aged 10 years and above, assessed using default body weights for children, adolescents, and adults Intervention or exposure: 750 mg/day collagen from fish skin in food supplements. Comparator/control: NOAEL from chronic rat study and margin-of-exposure threshold. Duration/follow-up: Risk assessment of 750 mg/day intake; no clinical follow-up Endpoints: margin of exposure, estimated mg/kg/day exposure, NOAEL comparison, fish-allergy vulnerability, uncertainties. Direction/effect: VKM concluded it was unlikely that 750 mg/day collagen from fish skin would cause adverse health effects in children aged 10 years and above, adolescents, or adults, based on MOE values above 100. Safety notes: Persons already sensitized and allergic to fish may be vulnerable to collagen/gelatin from fish; hydrolysis effects on allergic properties were uncertain. Limitations: Risk assessment relies on a rat NOAEL rather than human toxicity studies.; No toxicity studies of fish collagen in the general human population were found by VKM.; Unknown how hydrolysis affects allergic properties.; Dose assessed was 750 mg/day, below many modern collagen peptide supplement doses.. Population mismatch: Regulatory assessment using animal NOAEL and default body weights, not a human HCP trial.

**Why it matters:** Regulatory fish-collagen risk assessment with explicit dose, allergy, and uncertainty boundaries.

**Potential experiment signals:** safety:fish-skin-collagen, safety:margin-of-exposure, safety:fish-allergy, limitation:human-data-gap.

**Protocol takeaway:** Use source_artifact:vkm-fish-collagen-risk-assessment-2016-12-12 as fish-skin collagen regulatory risk-assessment context only.

**Claim use:** `safety-only`. Directness: `adjacent_variant`. Rights status guess: `unknown`.
