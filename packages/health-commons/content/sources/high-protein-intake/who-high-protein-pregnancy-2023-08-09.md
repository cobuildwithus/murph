---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:who-high-protein-pregnancy-2023-08-09
slug: sources/high-protein-intake/who-high-protein-pregnancy-2023-08-09
title: "High-protein supplementation during pregnancy"
summary: "Protein Floor source ledger record (safety-only; clinical_supervised)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - safety_digestive_liver_pregnancy_tolerance
relations:

  -
    type: related_protocol
    target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
  -
    type: parent_family
    target: experiment_family:high-protein-intake
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://www.who.int/tools/elena/interventions/high-protein-pregnancy/
  identityAliases:
    - source_artifact:who-high-protein-pregnancy-2023-08-09
  canonicalUrl: https://www.who.int/tools/elena/interventions/high-protein-pregnancy/
source:
  kind: web_page
  title: "High-protein supplementation during pregnancy"
  authors: World Health Organization
  journal: WHO eLENA
  url: https://www.who.int/tools/elena/interventions/high-protein-pregnancy/
researchEvidence:
  designKind: guideline
  designLabel: guideline
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-012; priority: backbone; claimUse: safety-only; directness: clinical_supervised"
sourceFindings:

  -
    findingId: finding:who-high-protein-pregnancy-2023-08-09-not-recommended-undernourished-pregnancy
    sourceKey: source_artifact:who-high-protein-pregnancy-2023-08-09
    extractedFromArtifactId: art_who_high_protein_pregnancy_2023_08_09
    findingKind: safety
    population: "Pregnant women in undernourished populations."
    exposure: "High-protein supplementation during pregnancy."
    outcome: "Maternal and perinatal outcomes."
    summary: "WHO states that, in undernourished populations, high-protein supplementation is not recommended for pregnant women to improve maternal and perinatal outcomes."
    evidenceUse:
      - safety
  -
    findingId: finding:who-high-protein-pregnancy-2023-08-09-limited-evidence-sga-risk
    sourceKey: source_artifact:who-high-protein-pregnancy-2023-08-09
    extractedFromArtifactId: art_who_high_protein_pregnancy_2023_08_09
    findingKind: safety
    population: "Pregnant women considered for high-protein supplementation."
    exposure: "High-protein supplementation."
    outcome: "Health benefits and small-for-gestational-age birth."
    summary: "WHO summarizes the evidence as very limited, with no positive health benefits for women and an increased risk of small-for-gestational-age babies."
    evidenceUse:
      - safety
  -
    findingId: finding:who-high-protein-pregnancy-2023-08-09-balanced-energy-protein-distinction
    sourceKey: source_artifact:who-high-protein-pregnancy-2023-08-09
    extractedFromArtifactId: art_who_high_protein_pregnancy_2023_08_09
    findingKind: context
    population: "Undernourished pregnant women."
    exposure: "Balanced protein-energy supplementation with protein providing less than 25% of total energy."
    outcome: "Gestational weight gain and pregnancy outcomes."
    summary: "WHO distinguishes balanced protein-energy supplementation from high-protein supplementation; balanced products may improve outcomes in undernourished pregnancy, but that does not support high-protein supplementation."
    evidenceUse:
      - context
      - safety
evidenceBucket: safety_digestive_liver_pregnancy_tolerance
protocolTakeaway: "Protocol safety copy should treat pregnancy or attempts to conceive as a clinician-guidance boundary."
claimUse: safety-only
directness: clinical_supervised
murphV1Priority: backbone
aliases:
  - who-high-protein-pregnancy-2023-08-09
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** safety-only (clinical_supervised).
- **Evidence bucket:** safety_digestive_liver_pregnancy_tolerance.
- **Extraction batch:** batch-012.

## Artifact pointer

- **art_who_high_protein_pregnancy_2023_08_09** — external html pointer; rights: unknown; redistributable: False

## Extracted findings

- **finding:who-high-protein-pregnancy-2023-08-09-not-recommended-undernourished-pregnancy** — WHO states that, in undernourished populations, high-protein supplementation is not recommended for pregnant women to improve maternal and perinatal outcomes.
- **finding:who-high-protein-pregnancy-2023-08-09-limited-evidence-sga-risk** — WHO summarizes the evidence as very limited, with no positive health benefits for women and an increased risk of small-for-gestational-age babies.
- **finding:who-high-protein-pregnancy-2023-08-09-balanced-energy-protein-distinction** — WHO distinguishes balanced protein-energy supplementation from high-protein supplementation; balanced products may improve outcomes in undernourished pregnancy, but that does not support high-protein supplementation.

## Protocol appraisal

- **evidence_appraisal:protein-floor-high-protein-intake:who-high-protein-pregnancy-2023-08-09** — WHO does not recommend high-protein supplementation in undernourished pregnancy. Implication: Protocol safety copy should treat pregnancy or attempts to conceive as a clinician-guidance boundary.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
