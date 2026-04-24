---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1016-j.scispo.2019.07.013"
slug: "sources/creatine-supplementation/doi-10.1016-j.scispo.2019.07.013"
title: "Is creatine hydrochloride better than creatine monohydrate for the improvement of physical performance and hormonal changes in young trained men?"
summary: "Double-blind short-term comparison of creatine hydrochloride with low-dose and loading-dose creatine monohydrate in trained young men; accessible abstracts report no clear advantage for hydrochloride over monohydrate on performance or hormone markers."
status: draft
quality: usable
aliases:
  - "Is creatine hydrochloride better than creatine monohydrate for the improvement of physical performance and hormonal changes in young trained men?"
  - "10.1016/j.scispo.2019.07.013"
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
  title: "Is creatine hydrochloride better than creatine monohydrate for the improvement of physical performance and hormonal changes in young trained men?"
  authors: "Tayebi M, Arazi H"
  year: 2020
  journal: "Science & Sports"
  citation: "Tayebi M, Arazi H. Is creatine hydrochloride better than creatine monohydrate for the improvement of physical performance and hormonal changes in young trained men? Science & Sports. 2020;35(5):e135-e141. doi:10.1016/j.scispo.2019.07.013."

  doi: "10.1016/j.scispo.2019.07.013"
  url: "https://doi.org/10.1016/j.scispo.2019.07.013"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "Randomized controlled trial"
  participantCount: 36

  populationLabel: "Healthy young trained men with at least six months of resistance training"
  durationLabel: "7 days"
  aggregateRole: primary
  cohortKey: "doi-10.1016-j.scispo.2019.07.013-trained-men"
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
    groupId: "doi-10.1016-j.scispo.2019.07.013"
    stance: "supports"
    scope: direct_protocol
    result: "no_clear_advantage"
    headline: "Creatine hydrochloride did not clearly outperform monohydrate in a 1-week trained-men trial."
    implication: "A short-term HCl comparison supports using monohydrate as the protocol default rather than switching to HCl for claimed absorption advantages."
    caveat: "Short duration, male trained sample, and paywalled/full details not fully extracted; endpoints were short-term performance and hormones rather than muscle creatine retention."
    displayPriority: 82
evidenceBucket: "formulation_variant_boundary"
whyItMatters: "This is a direct formulation comparator for HCl versus monohydrate and helps police claims that low-dose HCl is superior."
potentialMurphEndpoints:
  - "performance:strength-power"
  - "biomarker:testosterone"
  - "biomarker:cortisol"
  - "formulation:creatine-hydrochloride"
protocolTakeaway: "Do not state that creatine HCl is better than monohydrate for strength or hormonal changes based on this trial."
murphTakeaway: "For user experiments with HCl, keep outcomes separate from monohydrate and mark equivalence/superiority claims as unproven."
studyDesign: "rct"
modality: "creatine hydrochloride versus monohydrate"
claimUse: "supports-protocol"
murphV1Priority: "High"
pdfRightsStatus: "paywalled"
---

This source is included for **formulation_variant_boundary**.

**Findings:**
- **vigor, power, testosterone, cortisol, testosterone:cortisol ratio** — No significant between-group advantage was reported for 3 g/day creatine hydrochloride over 3 g/day or 20 g/day creatine monohydrate after one week. Source key: `source_artifact:doi-10.1016-j.scispo.2019.07.013`.
- **formulation dosing comparison** — Arms included 20 g/day creatine monohydrate, 3 g/day creatine monohydrate, 3 g/day creatine hydrochloride, and placebo. Source key: `source_artifact:doi-10.1016-j.scispo.2019.07.013`.

**Why it matters:** This is a direct formulation comparator for HCl versus monohydrate and helps police claims that low-dose HCl is superior.

**Potential experiment signals:** performance:strength-power, biomarker:testosterone, biomarker:cortisol, formulation:creatine-hydrochloride.

**Protocol takeaway:** Do not state that creatine HCl is better than monohydrate for strength or hormonal changes based on this trial.

**Claim use:** `supports-protocol`.
