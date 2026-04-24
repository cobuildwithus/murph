---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1163-17552559-00001101"
slug: "sources/creatine-supplementation/doi-10.1163-17552559-00001101"
title: "Effects of resistance training combined with creatine hydrochloride or creatine monohydrate supplementation on oxidative stress-antioxidant markers in trained women: a double-blind randomized placebo-controlled trial"
summary: "Double-blind RCT in trained women comparing resistance training plus creatine hydrochloride, creatine monohydrate with loading, creatine monohydrate without loading, or placebo for 8 weeks; creatine groups improved oxidative stress/antioxidant markers versus placebo, and HCl did not show greater effects than monohydrate."
status: draft
quality: usable
aliases:
  - "Effects of resistance training combined with creatine hydrochloride or creatine monohydrate supplementation on oxidative stress-antioxidant markers in trained women: a double-blind randomized placebo-controlled trial"
  - "10.1163/17552559-00001101"
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
  title: "Effects of resistance training combined with creatine hydrochloride or creatine monohydrate supplementation on oxidative stress-antioxidant markers in trained women: a double-blind randomized placebo-controlled trial"
  authors: "Dadvand SS, Arazi H"
  year: 2025
  journal: "Comparative Exercise Physiology"
  citation: "Dadvand SS, Arazi H. Effects of resistance training combined with creatine hydrochloride or creatine monohydrate supplementation on oxidative stress-antioxidant markers in trained women: a double-blind randomized placebo-controlled trial. Comparative Exercise Physiology. 2025;21(3):157-170. doi:10.1163/17552559-00001101."

  doi: "10.1163/17552559-00001101"
  url: "https://doi.org/10.1163/17552559-00001101"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "Randomized controlled trial"
  participantCount: 48

  populationLabel: "Young trained women"
  durationLabel: "8 weeks resistance training, 3 sessions per week"
  aggregateRole: context
  cohortKey: "doi-10.1163-17552559-00001101-trained-women"
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
    groupId: "doi-10.1163-17552559-00001101"
    stance: "supports"
    scope: direct_protocol
    result: "no_clear_advantage"
    headline: "HCl did not produce greater oxidative-stress marker effects than monohydrate in trained women."
    implication: "Female-population direct comparator evidence does not support replacing monohydrate with HCl for claimed superiority."
    caveat: "Primary endpoints were oxidative stress/antioxidant biomarkers, not muscle creatine retention or classic performance outcomes; PDF redistribution rights are not established."
    displayPriority: 70
evidenceBucket: "formulation_variant_boundary"
whyItMatters: "It expands direct formulation comparisons to trained women and biomarker outcomes."
potentialMurphEndpoints:
  - "biomarker:malondialdehyde"
  - "biomarker:8-ohdg"
  - "biomarker:sod"
  - "biomarker:gpx"
  - "biomarker:catalase"
  - "formulation:creatine-hydrochloride"
protocolTakeaway: "HCl is not supported as superior to monohydrate; biomarker endpoints should be kept separate from strength/hypertrophy claims."
murphTakeaway: "Do not over-translate oxidative marker changes into felt performance outcomes in user experiments."
studyDesign: "rct"
modality: "creatine hydrochloride versus monohydrate during resistance training"
claimUse: "supports-protocol"
murphV1Priority: "Medium"
pdfRightsStatus: "paywalled"
---

This source is included for **formulation_variant_boundary**.

**Findings:**
- **MDA, SOD, 8-OHdG, GPX, CAT** — Creatine hydrochloride, monohydrate-loading, and monohydrate-without-loading groups showed favorable changes in several oxidative stress/antioxidant markers versus placebo; CAT did not change significantly, and HCl did not produce greater effects than monohydrate. Source key: `source_artifact:doi-10.1163-17552559-00001101`.
- **muscle creatine content and diet control** — The authors identified lack of muscle creatine measurement and diet-control limitations. Source key: `source_artifact:doi-10.1163-17552559-00001101`.

**Why it matters:** It expands direct formulation comparisons to trained women and biomarker outcomes.

**Potential experiment signals:** biomarker:malondialdehyde, biomarker:8-ohdg, biomarker:sod, biomarker:gpx, biomarker:catalase, formulation:creatine-hydrochloride.

**Protocol takeaway:** HCl is not supported as superior to monohydrate; biomarker endpoints should be kept separate from strength/hypertrophy claims.

**Claim use:** `supports-protocol`.
