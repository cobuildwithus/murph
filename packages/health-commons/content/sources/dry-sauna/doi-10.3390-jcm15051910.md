---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3390-jcm15051910
slug: sources/dry-sauna/doi-10.3390-jcm15051910
title: Acute Heat Exposure-Related Illness: A Unified Emergency Medicine Framework for Hot Baths, Hot Springs, and Saunas—A Narrative Review
summary: Open-access emergency-medicine narrative review integrating hot baths, hot springs, and saunas as acute heat exposures that can trigger cardiovascular, heat-illness, renal/electrolyte, neurological, and traumatic presentations.
status: draft
quality: usable
aliases:
  - Yokoyama 2026 acute heat exposure-related illness
  - JCM 2026 hot baths hot springs saunas narrative review
categories:
  - dry-sauna
relations:

  -
    type: related_protocol
    target: protocol_variant:dry-sauna/bryan-johnson-blueprint

  -
    type: parent_family
    target: experiment_family:dry-sauna
source:
  kind: journal_article
  title: Acute Heat Exposure-Related Illness: A Unified Emergency Medicine Framework for Hot Baths, Hot Springs, and Saunas—A Narrative Review
  authors: Ryuto Yokoyama; Kenya Yarimizu; Tatsuya Hayasaka; Kento Sakaguchi; Masahiro Kuroki; Kiyotaka Soekawa; Tadahiro Kobayashi; Tsuneo Konta
  year: 2026
  journal: Journal of Clinical Medicine
  citation: Yokoyama R, Yarimizu K, Hayasaka T, Sakaguchi K, Kuroki M, Soekawa K, Kobayashi T, Konta T. Acute Heat Exposure-Related Illness: A Unified Emergency Medicine Framework for Hot Baths, Hot Springs, and Saunas—A Narrative Review. J Clin Med. 2026;15(5):1910. doi:10.3390/jcm15051910.
  pmid: "41827327"
  doi: 10.3390/jcm15051910
  url: https://www.mdpi.com/2077-0383/15/5/1910
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmid: "41827327"
    doi: 10.3390/jcm15051910
    pmcid: PMC12986314
    url: https://www.mdpi.com/2077-0383/15/5/1910
  canonicalUrl: https://www.mdpi.com/2077-0383/15/5/1910
researchEvidence:
  designKind: narrative_review
  designLabel: Emergency medicine narrative review
  participantCount: 97
  populationLabel: People presenting with acute illness after hot bath, hot spring, or sauna exposure; emphasis on vulnerable individuals including older adults and people with comorbidities, medications, or alcohol exposure.
  durationLabel: Narrative search from PubMed/MEDLINE inception to January 2026; no intervention duration.
  aggregateRole: synthesis
  cohortKey: yokoyama-2026-acute-heat-exposure-illness-review
  notes:
    - interventionOrExposure: Acute heat exposure from hot-water bathing, hot springs, and saunas.
    - comparatorOrControl: No formal comparator; qualitative framework across modalities.
    - endpoints: syncope; hypotension; arrhythmia or ischemia in vulnerable individuals; heat exhaustion and heat stroke; renal and electrolyte disturbance; falls; drowning or aspiration
    - effectEstimatesOrDirection: Mechanistic safety direction: acute heat exposure can cause peripheral vasodilation, relative hypovolemia, circulatory stress, internal heat storage, and emergency presentations.
    - adverseEventsOrSafetyNotes: Syncope, hypotension, drowning/aspiration, heat-related illness, renal/electrolyte disturbances, neurological/traumatic complications, arrhythmic/ischemic complications in vulnerable people.
    - limitations: Narrative review, not systematic review.; PubMed/MEDLINE primary database.; No meta-analysis or formal risk-of-bias assessment.; Combines water immersion and sauna modalities with different exposure physics.
    - populationMismatch: Emergency-care framing and mixed modalities, not healthy Bryan-protocol users.
    - directnessToProtocol: Mechanistically relevant but not direct protocol efficacy evidence.
evidenceBucket: Safety, heat illness, medications, pregnancy, alcohol, older-adult risk
whyItMatters: It connects sauna to emergency-relevant mechanisms beyond core temperature alone, including hemodynamic collapse and trauma.
potentialMurphEndpoints:
  - resting heart rate
  - morning blood pressure
  - dizziness or syncope
  - hydration and electrolytes
  - heat illness symptoms
protocolTakeaway: Use to support hemodynamic, hydration, alcohol, medication, and older-adult risk boundaries; do not use for benefit claims.
murphTakeaway: Risk monitoring should look beyond temperature: presyncope, blood pressure instability, dehydration, and falls matter.
studyDesign: Narrative review with qualitative synthesis
modality: Hot baths, hot springs, and saunas as acute heat exposure
claimUse: safety-only
sourceFindings:

  -
    findingId: finding:doi-10.3390-jcm15051910:acute-heat-exposure-framework
    sourceKey: source_artifact:doi-10.3390-jcm15051910
    extractedFromArtifactId: art_doi_10_3390_jcm15051910
    findingKind: mechanistic
    population: People exposed to hot baths, hot springs, or saunas, especially vulnerable individuals.
    exposure: Acute heat exposure.
    outcome: Emergency-relevant pathophysiology and clinical presentation.
    summary: The review frames hot baths, hot springs, and saunas as acute heat exposures that induce peripheral vasodilation, relative hypovolemia, circulatory stress, and internal heat storage, potentially triggering cardiovascular, heat-illness, renal/electrolyte, neurological, and traumatic events.
    evidenceUse:
      - mechanism
      - safety

  -
    findingId: finding:doi-10.3390-jcm15051910:high-risk-modifiers
    sourceKey: source_artifact:doi-10.3390-jcm15051910
    extractedFromArtifactId: art_doi_10_3390_jcm15051910
    findingKind: safety
    population: Older adults and people with comorbidities, heat-sensitive medications, or alcohol exposure.
    exposure: Acute heat exposure from baths, hot springs, or saunas.
    outcome: Modified risk of acute heat exposure-related illness.
    summary: The review identifies age, comorbidities, medications, and alcohol use as modifiers that can amplify acute heat-exposure risk and inform prevention strategies such as limiting duration, hydration/electrolyte support, supervision, and avoiding alcohol.
    evidenceUse:
      - safety
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **Safety, heat illness, medications, pregnancy, alcohol, older-adult risk**.

**Findings:** The review frames hot baths, hot springs, and saunas as acute heat exposures that induce peripheral vasodilation, relative hypovolemia, circulatory stress, and internal heat storage, potentially triggering cardiovascular, heat-illness, renal/electrolyte, neurological, and traumatic events. The review identifies age, comorbidities, medications, and alcohol use as modifiers that can amplify acute heat-exposure risk and inform prevention strategies such as limiting duration, hydration/electrolyte support, supervision, and avoiding alcohol.

**Why it matters:** It connects sauna to emergency-relevant mechanisms beyond core temperature alone, including hemodynamic collapse and trauma.

**Potential experiment signals:** resting heart rate, morning blood pressure, dizziness or syncope, hydration and electrolytes, heat illness symptoms.

**Protocol takeaway:** Use to support hemodynamic, hydration, alcohol, medication, and older-adult risk boundaries; do not use for benefit claims.

**Claim use:** `safety-only`.
