---
schemaVersion: "murph.commons.page.v1"
entityType: "experiment_family"
key: "experiment_family:psyllium-husk"
slug: "families/psyllium-husk"
title: "Psyllium Husk"
summary: "Psyllium husk is a gel-forming soluble-fiber intervention family whose Murph variants must specify the target outcome, dose, formulation, hydration, and safety boundaries."
status: "draft"
quality: "usable"
aliases:
  - "psyllium husk"
  - "psyllium seed husk"
  - "psyllium fiber"
  - "psyllium soluble fiber"
  - "ispaghula husk"
  - "isabgol"
  - "Plantago ovata husk"
  - "psyllium hydrophilic mucilloid"
categories:
  - "fiber"
  - "soluble-fiber"
  - "cholesterol"
  - "cardiovascular"
  - "gastrointestinal-safety"
familyKind: "single_intervention_family"
canonicalIntervention: "psyllium_husk"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "primary_biomarker"
    target: "biomarker:ldl-c"
  -
    type: "secondary_biomarker"
    target: "biomarker:total-cholesterol"
  -
    type: "secondary_biomarker"
    target: "biomarker:non-hdl-c"
  -
    type: "cites"
    target: "source_artifact:doi-10.1016-j.jff.2023.105878"
  -
    type: "cites"
    target: "source_artifact:pmid-30239559"
  -
    type: "cites"
    target: "source_artifact:pmid-10648260"
  -
    type: "cites"
    target: "source_artifact:pmid-18985059"
  -
    type: "cites"
    target: "source_artifact:cornell-law-cfr-201-319-2026-04-26"
  -
    type: "cites"
    target: "source_artifact:dailymed-metamucil-psyllium-label-2026-04-26"
lineage:
  relationship: "root"
  rationale: "Root family for Murph psyllium husk variants; outcome-specific variants should remain separate from constipation-only, generic soluble-fiber, portfolio-diet, pediatric, diabetes, and external named protocols."
attribution:
  ownerType: "murph"
  note: "Murph canonical family page assembled from psyllium cholesterol research extraction outputs."
claims:
  -
    claimId: "family-direct-lipid-evidence"
    type: "evidence_scope"
    text: "The strongest protocol-ready evidence in this family is for psyllium/ispaghula/Plantago ovata husk interventions with LDL-C and total-cholesterol lipid endpoints, not for generic fiber products or constipation-only use."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:doi-10.1016-j.jff.2023.105878"
      - "source_artifact:pmid-30239559"
      - "source_artifact:pmid-10648260"
      - "source_artifact:pmid-18985059"
  -
    claimId: "family-safety-liquid-boundary"
    type: "safety"
    text: "Psyllium-family protocols need explicit liquid-volume, prompt-swallowing, swallowing, obstruction, medication-spacing, and allergy guardrails because label/regulatory sources and case reports describe rare but serious choking, obstruction, and hypersensitivity boundaries."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:cornell-law-cfr-201-319-2026-04-26"
      - "source_artifact:dailymed-metamucil-psyllium-label-2026-04-26"
      - "source_artifact:pmid-12681118"
      - "source_artifact:pmid-14700444"
      - "source_artifact:fda-otc-monograph-m007-laxative-2023-05-02"
      - "source_artifact:medicines-org-uk-fybogel-plain-smpc-2026-04-26"
---
Psyllium husk is treated as a **family**, not a single universal protocol. A cholesterol-focused variant is different from a constipation-relief use case, a generic soluble-fiber comparison, a portfolio-diet protocol, a diabetes/glycemic-control protocol, or an external named commercial protocol.

For cholesterol work, Murph should preserve the details that make the experiment interpretable: active psyllium/ispaghula husk grams per day, formulation, divided dosing, liquid volume, medication spacing, diet and lipid-medication stability, and pre/post lab lipid panels. The direct family signal is strongest for LDL-C and total cholesterol, with non-HDL-C and apoB useful when available; HDL-C and triglycerides should be tracked as context rather than promised outcomes [source_artifact:doi-10.1016-j.jff.2023.105878; source_artifact:pmid-30239559; source_artifact:pmid-10648260; source_artifact:pmid-18985059].

Safety is part of the family definition. Psyllium should not be represented as a harmless add-on: users need at least 8 oz / 240 mL liquid or stricter product-label directions per dose, prompt swallowing before thickening, swallowing and obstruction screening, allergy/sensitization screening, and medication-spacing guidance before it is turned into an experiment [source_artifact:cornell-law-cfr-201-319-2026-04-26; source_artifact:dailymed-metamucil-psyllium-label-2026-04-26; source_artifact:pmid-12681118; source_artifact:pmid-14700444].
