---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:pmcid-PMC1372526
slug: sources/alcohol-abstinence/pmcid-pmc1372526
title: Effectiveness of general practice interventions for patients with excessive alcohol consumption
summary: Review of early general-practice intervention studies for harmful or excessive alcohol consumption; useful historical comparator context, not direct evidence for a 7-, 14-, or 30-day alcohol-free challenge.
status: draft
quality: usable
aliases:
- Effectiveness of general practice interventions for patients with excessive alcohol consumption
- pmcid-PMC1372526
- Anderson Scott general practice alcohol intervention review
categories:
- alcohol-abstinence
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
source:
  kind: review
  title: Effectiveness of general practice interventions for patients with excessive alcohol consumption
  authors: Peter Anderson; E Scott
  year: 1992
  journal: British Journal of General Practice
  citation: Anderson P, Scott E. Effectiveness of general practice interventions for patients with excessive alcohol consumption. British Journal of General Practice. 1992. PMCID:PMC1372526.
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC1372526/
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: pmcid
  identifiers:
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC1372526/
    pmcid: PMC1372526
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC1372526/
researchEvidence:
  designKind: narrative_review
  designLabel: Narrative review of general-practice alcohol intervention studies
  includedStudyCount: 6
  populationLabel: Patients with harmful or excessive alcohol consumption in general practice studies
  durationLabel: Reviewed studies with follow-up rather than a single fixed abstinence challenge
  aggregateRole: synthesis
  cohortKey: anderson-scott-1992-gp-alcohol-intervention-review
evidenceBucket: Registry, external protocol, and miscellaneous context records
whyItMatters: Preserves historical primary-care intervention context and reminds protocol authors that brief advice evidence is a comparator literature, not a direct voluntary abstinence-challenge literature.
potentialMurphEndpoints:
- self-reported alcohol intake
- AUDIT or similar screening score
- follow-up drinking frequency
protocolTakeaway: Use only as context for brief-advice and primary-care reduction literature; do not treat it as direct support for a Murph alcohol-free challenge.
murphTakeaway: Primary-care advice can help frame behavior-change support, but this review is not an abstinence challenge and should not drive endpoint claims.
studyDesign: Narrative review of published general-practice intervention studies
modality: Brief alcohol intervention / primary-care advice context
population: Patients in general-practice studies with harmful or excessive drinking.
interventionOrExposure: General-practice advice or brief intervention studies for excessive alcohol consumption.
comparatorOrControl: Varied comparators across reviewed studies.
durationOrFollowUp: Varied across the six reviewed studies.
endpoints:
- alcohol consumption
- general-practice intervention response
- follow-up alcohol-use outcomes
effectEstimatesOrDirection: Accessible abstract-level information indicates the review summarized six published studies and suggested general-practitioner interventions could reduce harmful alcohol consumption, but the source is not a single abstinence trial.
adverseEventsOrSafetyNotes: No adverse-event data were extracted from accessible abstract-level text.
limitations: Older review; heterogeneous included studies; not a direct 7-, 14-, or 30-day alcohol-free challenge; source ledger initially labelled it like an RCT, but accessible metadata supports review classification.
populationMismatch: General-practice patients with harmful drinking may differ from voluntary wellness users attempting short alcohol-free variants.
directnessToProtocol: adjacent_variant
claimUse: context-only
sourceFindings:
-
  findingId: finding:pmcid-pmc1372526-gp-intervention-review-context
  sourceKey: source_artifact:pmcid-PMC1372526
  findingKind: context
  population: Patients with harmful or excessive alcohol consumption in general-practice studies
  exposure: General-practice alcohol advice and brief intervention studies
  outcome: alcohol-consumption reduction context
  summary: The review summarizes early general-practice alcohol intervention studies; it is historical comparator context rather than direct abstinence-challenge evidence.
  evidenceUse:
  - context
  - adjacent_variant
murphV1Priority: Medium
pdfRightsStatus: open_access
---


This source is included for **Registry, external protocol, and miscellaneous context records**.

**Findings:** Accessible abstract-level information indicates the review summarized six published studies and suggested general-practitioner interventions could reduce harmful alcohol consumption, but the source is not a single abstinence trial.

**Why it matters:** Preserves historical primary-care intervention context and reminds protocol authors that brief advice evidence is a comparator literature, not a direct voluntary abstinence-challenge literature.

**Potential experiment signals:** self-reported alcohol intake, AUDIT or similar screening score, follow-up drinking frequency.

**Protocol takeaway:** Use only as context for brief-advice and primary-care reduction literature; do not treat it as direct support for a Murph alcohol-free challenge.

**Claim use:** `context-only`.

**Directness:** `adjacent_variant`.
