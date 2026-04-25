---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.16926-par.2021.09.11"
slug: "sources/creatine-supplementation/doi-10.16926-par.2021.09.11"
title: "Effects of creatine hydrochloride supplementation on physical performance and hormonal changes in soldiers"
summary: "Creatine hydrochloride trial in soldiers/young trained men without a monohydrate arm; included only as low-priority adjacent HCl context."
status: draft
quality: usable
aliases:
  - "Effects of creatine hydrochloride supplementation on physical performance and hormonal changes in soldiers"
  - "10.16926/par.2021.09.11"
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
  title: "Effects of creatine hydrochloride supplementation on physical performance and hormonal changes in soldiers"
  authors: "Tayebi SM et al."
  year: 2021
  journal: "Physical Activity Review"
  citation: "Tayebi SM et al. Effects of creatine hydrochloride supplementation on physical performance and hormonal changes in soldiers. Physical Activity Review. 2021. doi:10.16926/par.2021.09.11."

  doi: "10.16926/par.2021.09.11"
  url: "https://doi.org/10.16926/par.2021.09.11"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "Randomized controlled trial"

  populationLabel: "Soldiers / young trained men"
  durationLabel: "Not fully extracted"
  aggregateRole: context
  cohortKey: "doi-10.16926-par.2021.09.11-soldiers-hcl"
evidenceBucket: "formulation_variant_boundary"
whyItMatters: "It preserves an HCl-adjacent record while preventing unsupported cross-form claims."
potentialMurphEndpoints:
  - "performance:physical-performance"
  - "biomarker:hormonal-markers"
  - "formulation:creatine-hydrochloride"
  - "population:soldiers"
protocolTakeaway: "Exclude from direct monohydrate synthesis except as adjacent HCl context."
murphTakeaway: "Soldier/trained-male HCl-only outcomes are separate from monohydrate self-experiments."
studyDesign: "rct"
modality: "creatine hydrochloride only"
claimUse: "context-only"
murphV1Priority: "Low"
pdfRightsStatus: "unknown"
---

This source is included for **formulation_variant_boundary**.

**Findings:**
- **absence of monohydrate comparator** — The source evaluates creatine hydrochloride in soldiers/young trained men, but no monohydrate arm was identified in the canonical record. Source key: `source_artifact:doi-10.16926-par.2021.09.11`.

**Why it matters:** It preserves an HCl-adjacent record while preventing unsupported cross-form claims.

**Potential experiment signals:** performance:physical-performance, biomarker:hormonal-markers, formulation:creatine-hydrochloride, population:soldiers.

**Protocol takeaway:** Exclude from direct monohydrate synthesis except as adjacent HCl context.

**Claim use:** `context-only`.
