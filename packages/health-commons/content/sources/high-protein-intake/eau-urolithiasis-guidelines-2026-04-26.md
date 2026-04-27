---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:eau-urolithiasis-guidelines-2026-04-26
slug: sources/high-protein-intake/eau-urolithiasis-guidelines-2026-04-26
title: "EAU Guidelines on Urolithiasis"
summary: "Protein Floor source ledger record (safety-only; clinical_supervised)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - safety_gout_stone_uric_acid
relations:
  -
    type: related_protocol
    target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
  -
    type: parent_family
    target: experiment_family:high-protein-intake
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: https://uroweb.org/guidelines/urolithiasis/
  identityAliases:
    - source_artifact:eau-urolithiasis-guidelines-2026-04-26
  canonicalUrl: https://uroweb.org/guidelines/urolithiasis/
source:
  kind: guideline
  title: "EAU Guidelines on Urolithiasis"
  url: https://uroweb.org/guidelines/urolithiasis/
researchEvidence:
  designKind: guideline
  designLabel: guideline
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-011; priority: backbone; claimUse: safety-only; directness: clinical_supervised"
sourceFindings:
  -
    findingId: finding:eau-urolithiasis-guidelines-2026-04-26-animal-protein-limit
    findingKind: safety
    population: "Stone formers, including recurrent and high-risk stone formers."
    exposure: "Animal protein intake and general recurrence-prevention diet."
    outcome: "Kidney-stone recurrence risk and urinary risk factors."
    summary: "EAU recurrence-prevention advice lists limited animal protein content of 0.8–1.0 g/kg/day; excessive animal protein is described as favoring hypocitraturia, low urine pH, hyperoxaluria, and hyperuricosuria."
    evidenceUse:
      - safety
    sourceKey: source_artifact:eau-urolithiasis-guidelines-2026-04-26
    extractedFromArtifactId: art_eau_urolithiasis_guidelines_2026_04_26
  -
    findingId: finding:eau-urolithiasis-guidelines-2026-04-26-purine-hyperuricosuria-boundary
    findingKind: safety
    population: "Hyperuricosuric calcium oxalate stone formers and uric-acid stone formers."
    exposure: "Purine-rich food and animal-protein excess."
    outcome: "Urinary uric acid and uric-acid or calcium oxalate stone risk."
    summary: "EAU advises restricting purine-rich foods in hyperuricosuric calcium oxalate and uric-acid stone contexts, with purine intake not exceeding 500 mg/day."
    evidenceUse:
      - safety
      - measurement
    sourceKey: source_artifact:eau-urolithiasis-guidelines-2026-04-26
    extractedFromArtifactId: art_eau_urolithiasis_guidelines_2026_04_26
evidenceBucket: safety_gout_stone_uric_acid
protocolTakeaway: "High-protein targets should be modified or clinically supervised for users with stone history, hyperuricosuria, uric-acid stones, or low urine pH."
claimUse: safety-only
directness: clinical_supervised
murphV1Priority: backbone
aliases:
  - eau-urolithiasis-guidelines-2026-04-26
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** safety-only (clinical_supervised).
- **Evidence bucket:** safety_gout_stone_uric_acid.
- **Extraction batch:** batch-011.

## Artifact pointer

- **art_eau_urolithiasis_guidelines_2026_04_26** — external html pointer; rights: permission_required; redistributable: False

## Extracted findings

- **finding:eau-urolithiasis-guidelines-2026-04-26-animal-protein-limit** — EAU recurrence-prevention advice lists limited animal protein content of 0.8–1.0 g/kg/day; excessive animal protein is described as favoring hypocitraturia, low urine pH, hyperoxaluria, and hyperuricosuria.
- **finding:eau-urolithiasis-guidelines-2026-04-26-purine-hyperuricosuria-boundary** — EAU advises restricting purine-rich foods in hyperuricosuric calcium oxalate and uric-acid stone contexts, with purine intake not exceeding 500 mg/day.

## Protocol appraisal

- **evidence_appraisal:protein-floor-high-protein-intake:eau-urolithiasis-guidelines-2026-04-26** — EAU stone guidance sets a lower animal-protein and purine boundary for stone-prone users. Implication: High-protein targets should be modified or clinically supervised for users with stone history, hyperuricosuria, uric-acid stones, or low urine pH.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
