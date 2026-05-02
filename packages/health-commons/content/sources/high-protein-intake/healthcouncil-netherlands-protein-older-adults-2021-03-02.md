---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:healthcouncil-netherlands-protein-older-adults-2021-03-02
slug: sources/high-protein-intake/healthcouncil-netherlands-protein-older-adults-2021-03-02
title: "Systematic review of health effects of dietary protein in older adults"
summary: "Protein Floor source ledger record (context-only; general_guideline)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - external_guideline_context
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
    url: https://www.gezondheidsraad.nl/site/binaries/site-content/collections/documents/2021/03/02/voedingsnormen-voor-eiwitten/backgrounddocument-Systematic-review-of-health-effects-of-dietary-protein-in-older-adults.pdf/
  identityAliases:
    - source_artifact:healthcouncil-netherlands-protein-older-adults-2021-03-02
  canonicalUrl: https://www.gezondheidsraad.nl/site/binaries/site-content/collections/documents/2021/03/02/voedingsnormen-voor-eiwitten/backgrounddocument-Systematic-review-of-health-effects-of-dietary-protein-in-older-adults.pdf/
source:
  kind: guideline
  title: "Systematic review of health effects of dietary protein in older adults"
  authors: "Health Council of the Netherlands"
  journal: "Health Council of the Netherlands"
  url: https://www.gezondheidsraad.nl/site/binaries/site-content/collections/documents/2021/03/02/voedingsnormen-voor-eiwitten/backgrounddocument-Systematic-review-of-health-effects-of-dietary-protein-in-older-adults.pdf/
researchEvidence:
  designKind: systematic_review
  designLabel: "systematic review"
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-016; priority: high; claimUse: context-only; directness: general_guideline"
sourceFindings:

  -
    findingId: finding:healthcouncil-2021-older-adults-lean-mass
    findingKind: intervention_result
    population: "Older adults in 18 RCTs evaluating increased protein intake for lean body mass."
    exposure: "Increased protein intake, often replacing carbohydrate isocalorically, with and without exercise cointerventions."
    outcome: "Lean body mass and body weight."
    summary: "The committee concluded that increased protein intake had a possible beneficial effect on lean body mass in older adults without involving body-weight change; beneficial effects were observed up to total protein intake of about 1.7 g/kg/day, with no dose-response indication."
    evidenceUse:
      - adjacent_variant
      - context
    sourceKey: source_artifact:healthcouncil-netherlands-protein-older-adults-2021-03-02
    extractedFromArtifactId: art_healthcouncil_netherlands_protein_older_adults_2021_03_02
  -
    findingId: finding:healthcouncil-2021-older-adults-strength-function
    findingKind: intervention_result
    population: "Older adults in RCTs evaluating muscle strength and physical function."
    exposure: "Increased protein intake alone or with concomitant physical exercise, predominantly resistance training."
    outcome: "Muscle strength and physical function."
    summary: "Protein alone was judged likely to have no effect on muscle strength, while protein plus physical exercise had a possible beneficial strength effect; increased protein was judged likely to have no effect on physical function."
    evidenceUse:
      - adjacent_variant
      - context
    sourceKey: source_artifact:healthcouncil-netherlands-protein-older-adults-2021-03-02
    extractedFromArtifactId: art_healthcouncil_netherlands_protein_older_adults_2021_03_02
  -
    findingId: finding:healthcouncil-2021-older-adults-safety-uncertainty
    findingKind: safety
    population: "Older adults in RCTs included in the Health Council review."
    exposure: "Increased protein intake across included trials."
    outcome: "Bone health, serum lipids, blood pressure, glucose and insulin metabolism, cognition, and kidney function."
    summary: "The committee judged increased protein likely had no effect on bone health, found serum-lipid effects unclear, and found too few adequately powered or appropriate studies to draw conclusions about blood pressure, glucose and insulin metabolism, cognition, or kidney function."
    evidenceUse:
      - safety
      - context
    sourceKey: source_artifact:healthcouncil-netherlands-protein-older-adults-2021-03-02
    extractedFromArtifactId: art_healthcouncil_netherlands_protein_older_adults_2021_03_02
evidenceBucket: external_guideline_context
protocolTakeaway: "Useful context for measuring lean mass, strength, and safety labs, but not a standalone protocol claim for all Murph users."
claimUse: context-only
directness: general_guideline
murphV1Priority: high
aliases:
  - healthcouncil-netherlands-protein-older-adults-2021-03-02
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (general_guideline).
- **Evidence bucket:** external_guideline_context.
- **Extraction batch:** batch-016.

## Artifact pointer

- **art_healthcouncil_netherlands_protein_older_adults_2021_03_02** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:healthcouncil-2021-older-adults-lean-mass** — The committee concluded that increased protein intake had a possible beneficial effect on lean body mass in older adults without involving body-weight change; beneficial effects were observed up to total protein intake of about 1.7 g/kg/day, with no dose-response indication.
- **finding:healthcouncil-2021-older-adults-strength-function** — Protein alone was judged likely to have no effect on muscle strength, while protein plus physical exercise had a possible beneficial strength effect; increased protein was judged likely to have no effect on physical function.
- **finding:healthcouncil-2021-older-adults-safety-uncertainty** — The committee judged increased protein likely had no effect on bone health, found serum-lipid effects unclear, and found too few adequately powered or appropriate studies to draw conclusions about blood pressure, glucose and insulin metabolism, cognition, or kidney function.

## Protocol appraisal

- **evidence_appraisal:protein-floor-high-protein-intake:healthcouncil-netherlands-protein-older-adults-2021-03-02** — Older-adult systematic review shows lean-mass and strength-with-exercise signals, plus important null and uncertain endpoints. Implication: Useful context for measuring lean mass, strength, and safety labs, but not a standalone protocol claim for all Murph users.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
