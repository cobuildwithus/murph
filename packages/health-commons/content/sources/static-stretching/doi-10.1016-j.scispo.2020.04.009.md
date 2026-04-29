---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016/j.scispo.2020.04.009
slug: sources/static-stretching/doi-10.1016-j.scispo.2020.04.009
title: "Effects of different stretching exercises on hamstring flexibility and performance in long term"
summary: "Six-week RCT comparing active isolated, ballistic, static, and control conditions; static stretching improved flexibility but active isolated and ballistic stretching had larger gains, with no significant vertical-jump effect."
status: draft
quality: usable
aliases:
  - "Effects of different stretching exercises on hamstring flexibility and performance in long term"
  - "DOI 10.1016/j.scispo.2020.04.009"
categories:
  - static-stretching
relations:

  -
    type: related_protocol
    target: protocol_variant:static-stretching/at-home-static-stretching-for-flexibility
  -
    type: parent_family
    target: experiment_family:static-stretching
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: "10.1016/j.scispo.2020.04.009"
    url: "https://doi.org/10.1016/j.scispo.2020.04.009"
  canonicalUrl: "https://doi.org/10.1016/j.scispo.2020.04.009"
  identityAliases:
    - "Effects of different stretching exercises on hamstring flexibility and performance in long term"
source:
  kind: journal_article
  title: "Effects of different stretching exercises on hamstring flexibility and performance in long term"
  authors: "Gunaydin G; Citaker S; Cobanoglu G"
  year: 2020
  journal: "Science & Sports"
  citation: "Gunaydin G, Citaker S, Cobanoglu G. Effects of different stretching exercises on hamstring flexibility and performance in long term. Science & Sports. 2020. doi:10.1016/j.scispo.2020.04.009."
  doi: "10.1016/j.scispo.2020.04.009"
  url: "https://doi.org/10.1016/j.scispo.2020.04.009"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Randomized comparative stretching trial"
  participantCount: 56
  participantCountKind: reported
  populationLabel: "Participants randomized to active isolated, ballistic, static, or control groups"
  durationLabel: "6 weeks; 3 days per week"
  aggregateRole: context
  cohortKey: "gunaydin-2020-hamstring-flexibility-performance"
evidenceBucket: "hamstring_sit_reach"
directnessToProtocol: "adjacent_variant"
whyItMatters: "Preserves mixed evidence: static stretching helped flexibility but was not the top-performing modality, and performance transfer was not demonstrated."
potentialMurphEndpoints:
  - "Hamstring flexibility angle"
  - "Vertical jump performance"
  - "Stretch modality adherence"
protocolTakeaway: "Use for context that static stretching can improve flexibility without assuming superior performance transfer or superiority over all stretching variants."
murphTakeaway: "Murph experiments should not promise jump/performance improvements from a static hamstring stretch protocol based on this source."
studyDesign: "Randomized four-group comparison of active isolated stretching, ballistic stretching, static stretching, and control."
modality: "Static versus active isolated and ballistic hamstring stretching"
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: permission_required
---

This source is included for **hamstring_sit_reach**.

**Findings:**
1. Static stretching improved flexibility but was not the strongest stretching modality in this long-term comparator trial. Endpoint: Hamstring flexibility. Effect/direction: Flexibility increased with stretching; active isolated and ballistic stretching produced larger gains than static stretching in accessible reporting.
2. The flexibility gains did not translate into a clear vertical-jump performance effect in this study. Endpoint: Vertical jump performance. Effect/direction: Accessible reporting found no significant time effect or time-by-group interaction for vertical jump.

**Why it matters:** Preserves mixed evidence: static stretching helped flexibility but was not the top-performing modality, and performance transfer was not demonstrated.

**Potential experiment signals:**
- Hamstring flexibility angle
- Vertical jump performance
- Stretch modality adherence

**Protocol takeaway:** Use for context that static stretching can improve flexibility without assuming superior performance transfer or superiority over all stretching variants.

**Claim use:** `context-only`.

**Extraction notes:**
- Study design: Randomized four-group comparison of active isolated stretching, ballistic stretching, static stretching, and control.
- Population: 56 participants randomized equally across four groups in accessible reporting.
- Intervention/exposure: Static hamstring stretching.
- Comparator/control: Active isolated stretching, ballistic stretching, and control.
- Duration/follow-up: 6 weeks, 3 days per week.
- Endpoints: Hamstring flexibility measured with digital inclinometer, Vertical jump performance
- Adverse events or safety notes: Adverse events were not reported in accessible abstract/metadata.
- Limitations: Adjacent multi-modality comparison; performance endpoint limited to vertical jump; population details limited in accessible metadata.
- Population mismatch: Static stretching arm is relevant, but the source is primarily a comparator/performance-context study rather than a direct home protocol.
