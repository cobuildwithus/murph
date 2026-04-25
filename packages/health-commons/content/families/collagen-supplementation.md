---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:collagen-supplementation
slug: families/collagen-supplementation
title: Collagen Supplementation
summary: A protocol family for oral collagen-supplement interventions, kept split by product form, route, cointerventions, target outcome, and clinical versus self-experiment context.
status: field-testing
quality: usable
aliases:
- collagen supplements
- hydrolysed collagen
- native type-II collagen
- UC-II
- gelatin plus vitamin C
- bone broth
categories:
- supplement
- nutrition
- connective-tissue
- skin
- joint-health
- bone-health
- collagen-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: cites
  target: source_artifact:pmid-33742704
-
  type: cites
  target: source_artifact:pmid-30368550
-
  type: cites
  target: source_artifact:pmid-39212129
-
  type: cites
  target: source_artifact:pmid-40826844
-
  type: cites
  target: source_artifact:pmid-40324552
-
  type: cites
  target: source_artifact:pmid-30609761
-
  type: cites
  target: source_artifact:pmid-41049371
-
  type: cites
  target: source_artifact:pmid-29337906
-
  type: cites
  target: source_artifact:pmid-33068290
-
  type: cites
  target: source_artifact:pmid-37854210
-
  type: cites
  target: source_artifact:pmid-40253594
-
  type: cites
  target: source_artifact:pmid-27852613
-
  type: cites
  target: source_artifact:pmid-30859848
-
  type: cites
  target: source_artifact:pmid-29893587
-
  type: cites
  target: source_artifact:pmid-30122200
-
  type: cites
  target: source_artifact:pmid-31627309
-
  type: cites
  target: source_artifact:pmid-38931263
-
  type: cites
  target: source_artifact:pmid-30061579
-
  type: cites
  target: source_artifact:pmid-31859087
-
  type: cites
  target: source_artifact:pmid-38345088
-
  type: cites
  target: source_artifact:npiap-pressure-injury-guidelines-2026-04-25
-
  type: cites
  target: source_artifact:fda-dietary-supplements-2024-02-21
-
  type: cites
  target: source_artifact:ecfr-21-cfr-part-111-current-2026-04-25
-
  type: cites
  target: source_artifact:pmid-27569115
-
  type: cites
  target: source_artifact:pmid-31262631
-
  type: cites
  target: source_artifact:pmid-32389794
-
  type: cites
  target: source_artifact:pmid-40292256
familyKind: intervention
canonicalModality: oral_collagen_supplementation
researchCoverage:
  ledgerSourceCount: 307
  sourcePagesDrafted: 289
  auditDate: '2026-04-25'
  priorityCounts:
    backbone: 64
    high: 59
    medium: 121
    low: 45
    exclude: 18
  directnessCounts:
    direct_protocol: 126
    same_mechanism: 40
    adjacent_variant: 72
    background: 27
    safety_boundary: 31
    clinical_supervised: 11
  claimUseCounts:
    supports-protocol: 84
    context-only: 180
    safety-only: 25
    do-not-use: 18
  starterProtocolKey: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
  splitVariants:
  - hydrolyzed_collagen_peptides
  - native_undenatured_type_ii_collagen
  - gelatin_plus_vitamin_c_loading
  - bone_broth_or_collagen_foods
  - multi_ingredient_beauty_or_joint_blends
  - clinical_wound_burn_pressure_injury_nutrition
  - non_oral_topical_injectable_or_procedure_collagen
---

# Collagen Supplementation

Collagen Supplementation is a family, not a single intervention. The starter Murph protocol is **Hydrolyzed Collagen Peptides**, which covers oral collagen-peptide or collagen-hydrolysate products used as a bounded self-experiment. `[source_artifact:pmid-33742704; source_artifact:pmid-30368550; source_artifact:pmid-39212129]`

The family intentionally separates adjacent variants. Native or undenatured type-II collagen, gelatin plus vitamin C timed around loading, bone broth or collagen foods, multi-ingredient beauty/joint blends, clinical wound or fragility-fracture nutrition formulas, and topical/injectable/procedure collagen products should not be used as direct evidence for the HCP protocol unless the claim explicitly labels the mismatch. `[source_artifact:pmid-33068290; source_artifact:pmid-37854210; source_artifact:pmid-40253594; source_artifact:pmid-27852613; source_artifact:pmid-30859848; source_artifact:pmid-29893587; source_artifact:pmid-30122200; source_artifact:pmid-30061579]`

## Evidence posture

The collagen evidence base is endpoint-specific. Skin hydration, elasticity, wrinkle, and appearance endpoints have the most consistent direct HCP cluster. Joint/OA, tendon/loading, recovery/performance, and bone-density evidence are more mixed, population-specific, or dependent on cointerventions and long measurement windows. `[source_artifact:pmid-40826844; source_artifact:pmid-40324552; source_artifact:pmid-30609761; source_artifact:pmid-41049371; source_artifact:pmid-29337906]`

Family pages should preserve null, mixed, negative, and population-mismatch findings. A trial in postmenopausal osteopenia, older fragility-fracture care, clinical wound nutrition, or a multi-ingredient blend can be useful context, but it is not the same as a wellness HCP-alone self-experiment. `[source_artifact:pmid-41049371; source_artifact:pmid-30061579; source_artifact:pmid-31859087; source_artifact:pmid-38345088; source_artifact:npiap-pressure-injury-guidelines-2026-04-25]`

## Safety posture

The family uses a product-specific safety frame. Source species, fish/collagen/gelatin allergy, GI tolerance, labeling, cGMP, recalls, and contaminants are central guardrails for oral supplement variants. `[source_artifact:pmid-27569115; source_artifact:pmid-31262631; source_artifact:pmid-32389794; source_artifact:fda-dietary-supplements-2024-02-21; source_artifact:ecfr-21-cfr-part-111-current-2026-04-25; source_artifact:pmid-40292256]`

## Current canonical variant

- [Hydrolyzed Collagen Peptides](../protocols/collagen-supplementation/hydrolyzed-collagen-peptides.md) — oral HCP product, one target outcome, daily fixed dose, product identity and safety gates required.
