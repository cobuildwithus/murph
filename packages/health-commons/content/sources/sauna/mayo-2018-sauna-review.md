---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:mayo-2018-sauna-review
slug: sources/sauna/mayo-2018-sauna-review
title: "Cardiovascular and other health benefits of sauna bathing: a review of the evidence"
summary: "This narrative review synthesizes cardiovascular, inflammatory, and mortality evidence for sauna bathing. The main finding is a coherent mechanism-and-outcomes story, especially around cardiovascular stress, vascular function, and long-term associations. For Murph, it is rationale and mechanism context, not a substitute for protocol-specific intervention data."
status: draft
quality: usable
categories:
  - sauna
  - review
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: parent_family
    target: experiment_family:dry-sauna
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/bryan-johnson-blueprint
source:
  kind: review
  title: "Cardiovascular and other health benefits of sauna bathing: a review of the evidence"
  authors: JA Laukkanen, T Laukkanen, SK Kunutsor
  year: 2018
  journal: Mayo Clin Proc
  citation: "JA Laukkanen, T Laukkanen, SK Kunutsor. Cardiovascular and other health benefits of sauna bathing: a review of the evidence. Mayo Clin Proc 2018."
  pmid: "30077204"
  doi: 10.1016/j.mayocp.2018.04.008
  url: https://www.mayoclinicproceedings.org/article/S0025-6196(18)30275-1/fulltext
researchEvidence:
  designKind: "narrative_review"
  designLabel: "Evidence review"
  aggregateRole: "synthesis"
protocolEvidence:
  -
    protocolKey: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
    groupId: evidence-backbone-and-claim-calibration
    stance: mixed
    scope: same_mechanism
    result: mixed
    endpointKeys:
      - biomarker:resting-heart-rate
      - biomarker:morning-blood-pressure
      - biomarker:hrv-rmssd
    headline: "This narrative review synthesizes cardiovascular, inflammatory, and mortality evidence for sauna bathing. The main finding is a coherent mechanism-and-outcomes story, especially around cardiovascular stress, vascular function, and long-term associations."
    implication: "This source is rationale and mechanism context, not a substitute for protocol-specific intervention data."
    caveat: "Review evidence should calibrate rationale and claims; it does not prove this exact 21-day self-experiment will move wearable signals."
    displayPriority: 20
  -
    protocolKey: "protocol_variant:dry-sauna/bryan-johnson-blueprint"
    groupId: "independent-sauna-physiology-context"
    stance: context_only
    scope: same_mechanism
    result: not_efficacy_evidence
    endpointKeys:
      - biomarker:resting-heart-rate
      - biomarker:morning-blood-pressure
    headline: "Review explains why sauna can act like a real cardiovascular heat stressor."
    implication: "Use it for mechanism and endpoint selection, not as proof of the daily 200 F Blueprint routine."
    caveat: "Narrative review; the underlying studies use varied doses, populations, and outcomes."
    displayPriority: 40
evidenceBucket: Evidence backbone
whyItMatters: Strong narrative synthesis focused on cardiovascular mechanisms and outcomes
potentialMurphEndpoints:
  - BP
  - arterial stiffness
  - inflammation
  - mortality context
protocolTakeaway: Useful overview for rationale and mechanism section.
murphTakeaway: "This source is rationale and mechanism context, not a substitute for protocol-specific intervention data."
studyDesign: Review / meta
modality: Finnish dry sauna
finnishDrySaunaFocus: Yes
murphV1Priority: High
aliases:
  - Laukkanen 2018 Mayo sauna review
---

This source is included for **Evidence backbone**.

**Findings:** This narrative review synthesizes cardiovascular, inflammatory, and mortality evidence for sauna bathing. The main finding is a coherent mechanism-and-outcomes story, especially around cardiovascular stress, vascular function, and long-term associations.

**Why it matters:** Strong narrative synthesis focused on cardiovascular mechanisms and outcomes

**Potential experiment signals:** BP, arterial stiffness, inflammation, mortality context

**Protocol takeaway:** Useful overview for rationale and mechanism section.

This review is especially useful for rationale and modality framing, but it should not substitute for protocol-specific intervention data.
