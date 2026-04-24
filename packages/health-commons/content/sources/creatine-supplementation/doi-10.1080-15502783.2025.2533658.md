---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1080-15502783.2025.2533658"
slug: "sources/creatine-supplementation/doi-10.1080-15502783.2025.2533658"
title: "Creatine monohydrate versus creatine hydrochloride on strength and body composition in elite team-sport athletes: A placebo-controlled randomized clinical trial comparing low dosages"
summary: "Triple-blind placebo-controlled RCT in elite handball and softball athletes comparing 5 g/day creatine monohydrate, 5 g/day creatine hydrochloride, and maltodextrin placebo for 8 weeks; no between-group superiority was found for strength or body-composition outcomes."
status: draft
quality: usable
aliases:
  - "Creatine monohydrate versus creatine hydrochloride on strength and body composition in elite team-sport athletes: A placebo-controlled randomized clinical trial comparing low dosages"
  - "10.1080/15502783.2025.2533658"
  - "PMC12291177"
categories:
  - "creatine-supplementation"
relations:
  -
    type: related_protocol
    target: "protocol_variant:creatine-supplementation/creatine-monohydrate"
  -
    type: parent_family
    target: "experiment_family:creatine-supplementation"
source:
  kind: "journal_article"
  title: "Creatine monohydrate versus creatine hydrochloride on strength and body composition in elite team-sport athletes: A placebo-controlled randomized clinical trial comparing low dosages"
  authors: "Londoño-Velásquez D, Zuluaga-Narváez Y, Rojas-Posada L, Kammerer-López M, Cardona-Arenas OM, Quiroz-Bastidas OL, Quintero-Velásquez MA, Rojas-Jaramillo A, Kreider RB, Bonilla DA"
  year: 2025
  journal: "Journal of the International Society of Sports Nutrition"
  citation: "Londoño-Velásquez D, Zuluaga-Narváez Y, Rojas-Posada L, Kammerer-López M, Cardona-Arenas OM, Quiroz-Bastidas OL, Quintero-Velásquez MA, Rojas-Jaramillo A, Kreider RB, Bonilla DA. Creatine monohydrate versus creatine hydrochloride on strength and body composition in elite team-sport athletes: A placebo-controlled randomized clinical trial comparing low dosages. Journal of the International Society of Sports Nutrition. 2025;22(sup1):2533658. doi:10.1080/15502783.2025.2533658. PMCID:PMC12291177."

  doi: "10.1080/15502783.2025.2533658"
  url: "https://doi.org/10.1080/15502783.2025.2533658"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "Randomized controlled trial"
  participantCount: 31

  populationLabel: "Male and female elite team-sport athletes, handball and softball players, aged 18-28 years"
  durationLabel: "8 weeks"
  aggregateRole: primary
  cohortKey: "doi-10.1080-15502783.2025.2533658-elite-athletes"
protocolEvidence:
  -
    protocolKey: protocol_variant:creatine-supplementation/creatine-monohydrate
    groupId: formulation-head-to-head-boundaries
    stance: supports
    scope: adjacent_variant
    result: positive
    headline: "Included in the protocol evidence landscape group: Formulation head-to-head boundaries."
    implication: "Use this source within that landscape group while preserving the source-specific extraction caveats."
    caveat: "Interpret alongside the source narrative and the protocol's stated scope limits."
    displayPriority: 90
  -
    protocolKey: "protocol_variant:creatine-supplementation/creatine-monohydrate"
    groupId: "doi-10.1080-15502783.2025.2533658"
    stance: "supports"
    scope: direct_protocol
    result: "no_clear_advantage"
    headline: "Low-dose HCl and monohydrate produced similar outcomes, with no significant between-group superiority."
    implication: "This recent direct comparator supports keeping monohydrate as the default form and not treating HCl as superior at the same 5 g/day dose."
    caveat: "Elite sport population and low-dose design; within-group jump changes should not be overread as between-form superiority."
    displayPriority: 86
evidenceBucket: "formulation_variant_boundary"
whyItMatters: "It is a modern, direct, placebo-controlled HCl-versus-monohydrate trial in trained athletes using a common 5 g/day dose."
potentialMurphEndpoints:
  - "performance:isokinetic-shoulder-strength"
  - "performance:countermovement-jump"
  - "performance:drop-jump"
  - "body-composition:dxa-fat-free-mass"
  - "formulation:creatine-hydrochloride"
protocolTakeaway: "For monohydrate guidance, HCl is not supported as a superior replacement in this population/dose window."
murphTakeaway: "If a user reports HCl instead of monohydrate, treat it as an adjacent variant even when the dose is 5 g/day."
studyDesign: "rct"
modality: "low-dose creatine monohydrate versus hydrochloride"
claimUse: "supports-protocol"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---

This source is included for **formulation_variant_boundary**.

**Findings:**
- **neuromuscular performance and DXA body composition** — Between-group comparisons found no statistically significant differences across neuromuscular or body-composition variables. Source key: `source_artifact:doi-10.1080-15502783.2025.2533658`.
- **jump performance** — Within-group jump performance improved in both creatine groups, with similar small effect sizes; this was not a between-group superiority finding. Source key: `source_artifact:doi-10.1080-15502783.2025.2533658`.

**Why it matters:** It is a modern, direct, placebo-controlled HCl-versus-monohydrate trial in trained athletes using a common 5 g/day dose.

**Potential experiment signals:** performance:isokinetic-shoulder-strength, performance:countermovement-jump, performance:drop-jump, body-composition:dxa-fat-free-mass, formulation:creatine-hydrochloride.

**Protocol takeaway:** For monohydrate guidance, HCl is not supported as a superior replacement in this population/dose window.

**Claim use:** `supports-protocol`.
