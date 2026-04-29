---
schemaVersion: "murph.commons.page.v1"
entityType: "experiment_family"
key: "experiment_family:red-yeast-rice"
slug: "families/red-yeast-rice"
title: "Red Yeast Rice"
summary: "Monascus-fermented rice interventions for lipid experiments, kept product-specific because monacolin K is lovastatin-like and commercial RYR products vary in active content and safety profile."
status: "draft"
quality: "usable"
aliases:
  - "RYR"
  - "red fermented rice"
  - "red mold rice"
  - "Monascus purpureus rice"
  - "Monascus-fermented rice"
  - "hong qu"
  - "Hongqu"
  - "monacolin K red yeast rice"
categories:
  - "lipids"
  - "cholesterol"
  - "cardiovascular"
  - "supplement"
  - "product-quality"
  - "high-caution"
familyKind: "intervention"
canonicalMechanism: "monacolin_k_lovastatin_like_hmg_coa_reductase_inhibition_when_present"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "cites"
    target: "source_artifact:fda-dietary-supplement-ingredient-directory-red-yeast-rice-2025-05-23"
  -
    type: "cites"
    target: "source_artifact:nccih-red-yeast-rice-2026-04-26"
  -
    type: "cites"
    target: "source_artifact:pmid-24897342"
  -
    type: "cites"
    target: "source_artifact:pmid-31941089"
  -
    type: "cites"
    target: "source_artifact:pmid-28093797"
  -
    type: "cites"
    target: "source_artifact:eur-lex-regulation-2022-860-monacolins-red-yeast-rice-2022-06-01"
  -
    type: "cites"
    target: "source_artifact:pmid-36351465"
researchCoverage:
  protocolKey: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  auditDate: "2026-04-26"
  sourceCount: 283
  sourcePagesDrafted: 282
  excludedLedgerRecords: 1
  sourceIndexPresentInSnapshot: false
  priorityCounts:
    backbone: 56
    high: 103
    medium: 111
    low: 12
    exclude: 1
  directnessCounts:
    direct_protocol: 29
    same_mechanism: 77
    adjacent_variant: 76
    clinical_supervised: 12
    measurement_context: 40
    general_guideline: 49
  bucketCounts:

    -
      label: "Adjacent combinations and special-population evidence"
      count: 55
    -
      label: "Lipid measurement and test-plan context"
      count: 40
    -
      label: "Product quality, contamination, and dose uncertainty"
      count: 36
    -
      label: "Xuezhikang and proprietary Chinese RYR preparations"
      count: 30
    -
      label: "Regulatory and jurisdiction warnings"
      count: 29
    -
      label: "Evidence syntheses and reviews"
      count: 18
    -
      label: "Safety reviews and pharmacovigilance"
      count: 17
    -
      label: "Direct protocol and dose evidence"
      count: 16
    -
      label: "Safety case reports and adverse-event signals"
      count: 11
    -
      label: "Interactions, contraindications, and population boundaries"
      count: 10
    -
      label: "Guidelines and external protocol claims"
      count: 10
    -
      label: "Direct trial registry and future evidence watchlist"
      count: 7
---
Red yeast rice is the intervention family for Monascus-fermented rice products used in lipid experiments.

This family should stay product-specific. A red yeast rice label can refer to very different monacolin exposure, coingredients, citrinin testing, contamination risk, and regulatory status. The canonical Murph variant is **Red Yeast Rice For Cholesterol**, a high-caution LDL-C experiment with product documentation, safety screening, and baseline/follow-up lipid panels.

Keep these boundaries visible:

- Xuezhikang, Zhibituo, and Zhibitai are adjacent named proprietary preparations unless a protocol explicitly uses them.
- Multi-ingredient nutraceutical stacks are adjacent combination evidence unless a RYR-only arm isolates the effect.
- Beni-koji safety events are important product-specific contamination and kidney-safety boundary evidence, not direct efficacy evidence for ordinary RYR supplements.
- Regulatory and market status can change by jurisdiction, so the family page should not imply universal legality or authorized cholesterol claims.
