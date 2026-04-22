---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sauna-2005-miyamoto-safety-and-efficacy-of-repeated-sauna-bathing-in-patients
slug: sources/sauna/sauna-2005-miyamoto-safety-and-efficacy-of-repeated-sauna-bathing-in-patients
title: "Safety and efficacy of repeated sauna bathing in patients with chronic systolic heart failure: a preliminary report"
summary: "This pilot intervention tested repeated sauna bathing in chronic systolic heart failure patients. The main finding is that supervised repeated sauna may be feasible and physiologically meaningful in a clinical group, but the evidence is preliminary. For Murph, it supports ramping and safety monitoring, not unsupervised clinical advice."
status: draft
quality: usable
categories:
  - sauna
  - study
  - cardiovascular
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: parent_family
    target: experiment_family:dry-sauna
source:
  kind: journal_article
  title: "Safety and efficacy of repeated sauna bathing in patients with chronic systolic heart failure: a preliminary report"
  authors: "H. Miyamoto, H. Kai, H. Nakaura et al."
  year: 2005
  journal: "Journal of Cardiac Failure"
  citation: "H. Miyamoto, H. Kai, H. Nakaura et al., “Safety and efficacy of repeated sauna bathing in patients with chronic systolic heart failure: a preliminary report,” Journal of Cardiac Failure, vol. 11, no. 6, pp. 432–436, 2005."
researchEvidence:
  designKind: "pilot_intervention"
  designLabel: "Heart-failure pilot intervention"
  participantCount: 15
  participantCountKind: "reported"
  populationLabel: "Chronic systolic heart failure patients"
  durationLabel: "4-week repeated sauna intervention"
  aggregateRole: "primary"
  cohortKey: "miyamoto-2005-chf-pilot"
protocolEvidence:
  -
    protocolKey: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
    groupId: safety-dose-modality-and-context-boundaries
    stance: safety_boundary
    scope: clinical_supervised
    result: mixed
    endpointKeys:
      - biomarker:resting-heart-rate
      - biomarker:morning-blood-pressure
      - biomarker:hrv-rmssd
    headline: "This pilot intervention tested repeated sauna bathing in chronic systolic heart failure patients. The main finding is that supervised repeated sauna may be feasible and physiologically meaningful in a clinical group, but the evidence is preliminary."
    implication: "This source supports ramping and safety monitoring, not unsupervised clinical advice."
    caveat: "Safety and special-population records support screening, stopping rules, and logging; they are not efficacy proof."
    displayPriority: 40
  -
    protocolKey: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
    groupId: intervention-design-training-and-mixed-results
    stance: mixed
    scope: clinical_supervised
    result: mixed
    endpointKeys:
      - biomarker:resting-heart-rate
      - biomarker:morning-blood-pressure
      - biomarker:hrv-rmssd
    headline: "This supervised heart-failure pilot shows repeated sauna can be feasible and physiologically meaningful in a clinical setting, while staying far from a generic home claim."
    implication: "Useful for dose-ramping and expectation setting, not for unsupervised clinical advice."
    caveat: "Small supervised heart-failure pilot; it informs design realism more than it proves broad efficacy."
    displayPriority: 120
evidenceBucket: Finnish dry-sauna corpus
whyItMatters: "Expands the audited Finnish dry-sauna evidence corpus with a cardiovascular record marked medium priority for Murph v1 interpretation."
potentialMurphEndpoints:
  - blood pressure context
  - resting heart rate context
  - illness and respiratory context
protocolTakeaway: "Use as cardiovascular context around heat exposure, not as a guaranteed 21-day result-card endpoint."
murphTakeaway: "This source supports ramping and safety monitoring, not unsupervised clinical advice."
studyDesign: "Intervention study"
modality: "Sauna (likely dry)"
finnishDrySaunaFocus: "Likely"
murphV1Priority: "Medium"
sourceUrlCurationNote: Workbook source URL points to a bibliography or review backbone rather than a direct article landing page, so the public source link is intentionally omitted from the app card.
---

This source is part of Murph's audited Finnish dry-sauna yes/likely corpus.

**Findings:** This pilot intervention tested repeated sauna bathing in chronic systolic heart failure patients. The main finding is that supervised repeated sauna may be feasible and physiologically meaningful in a clinical group, but the evidence is preliminary.

**Why it matters:** Expands the audited Finnish dry-sauna evidence corpus with a cardiovascular record marked medium priority for Murph v1 interpretation.

**Potential Murph endpoints/context:** blood pressure context, resting heart rate context, illness and respiratory context

**Protocol takeaway:** Use as cardiovascular context around heat exposure, not as a guaranteed 21-day result-card endpoint.

The workbook linked this record through a review or bibliography backbone rather than a direct article page. Keep it in the corpus, but do not show a potentially misleading outbound source link in the product UI.
