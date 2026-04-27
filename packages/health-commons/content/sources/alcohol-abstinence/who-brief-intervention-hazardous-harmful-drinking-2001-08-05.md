---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:who-brief-intervention-hazardous-harmful-drinking-2001-08-05
slug: sources/alcohol-abstinence/who-brief-intervention-hazardous-harmful-drinking-2001-08-05
title: 'Brief Intervention for Hazardous and Harmful Drinking: A Manual for Use in Primary Care'
summary: WHO describes an AUDIT-informed primary-care brief-intervention framework for hazardous and harmful drinking; it supports screening/referral context but does not test abstinence challenges.
status: draft
quality: usable
aliases:
- 'Brief Intervention for Hazardous and Harmful Drinking: A Manual for Use in Primary Care'
- who-brief-intervention-hazardous-harmful-drinking-2001-08-05
categories:
- alcohol-abstinence
- alcohol-reduction-comparator
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
source:
  kind: guideline
  title: 'Brief Intervention for Hazardous and Harmful Drinking: A Manual for Use in Primary Care'
  authors: Babor TF; Higgins-Biddle JC; World Health Organization
  year: 2001
  journal: World Health Organization
  citation: 'Babor TF, Higgins-Biddle JC; World Health Organization. Brief Intervention for Hazardous and Harmful Drinking: A Manual for Use in Primary Care. Geneva: World Health Organization; 2001. https://www.who.int/publications/i/item/brief-intervention-for-hazardous-and-harmful-drinking-%28audit%29'
  url: https://www.who.int/publications/i/item/brief-intervention-for-hazardous-and-harmful-drinking-%28audit%29
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: bf61f4710440b31606d96e6bbf2c5ba708949799b2730fb7b3f3680250e6484c
    url: https://www.who.int/publications/i/item/brief-intervention-for-hazardous-and-harmful-drinking-%28audit%29
  canonicalUrl: https://www.who.int/publications/i/item/brief-intervention-for-hazardous-and-harmful-drinking-%28audit%29
researchEvidence:
  designKind: guideline
  designLabel: WHO primary-care brief-intervention manual
  populationLabel: Primary-care patients with hazardous or harmful drinking
  durationLabel: Manual guidance; no single follow-up duration
  aggregateRole: context
  cohortKey: who-2001-audit-brief-intervention-primary-care
evidenceBucket: WHO brief-intervention guideline context
whyItMatters: Useful for framing screening, brief advice, and referral, especially for higher-risk drinking patterns.
potentialMurphEndpoints:
- AUDIT score
- hazardous drinking flag
- referral threshold
protocolTakeaway: Use as guideline context for screening/referral boundaries; not direct efficacy evidence.
murphTakeaway: Murph challenge flows should acknowledge when a user needs brief intervention or clinical referral rather than self-experimentation alone.
studyDesign: WHO implementation manual/guideline
modality: AUDIT-informed primary-care brief intervention
population: People in primary care whose alcohol consumption has become hazardous or harmful.
interventionOrExposure: AUDIT-informed brief intervention and primary-care counseling framework.
comparatorOrControl: Not applicable; implementation manual.
durationOrFollowUp: Manual guidance; no single follow-up duration
endpoints:
- hazardous drinking identification
- harmful drinking counseling
- reduction or cessation advice
effectEstimatesOrDirection: The manual provides techniques for short-term primary-care interventions intended to help risky drinkers reduce or cease alcohol consumption and avoid harms; it is not a trial or effect-estimate source.
adverseEventsOrSafetyNotes: Designed to support appropriate primary-care response to hazardous or harmful drinking; not an adverse-event study.
limitations: Manual/guideline source, not direct evidence for a self-directed abstinence challenge.
populationMismatch: Primary-care hazardous/harmful drinking context may include patients requiring clinical support, not wellness self-experimentation.
directnessToProtocol: general_guideline
claimUse: context-only
sourceFindings:
-
  findingId: finding:who-brief-intervention-primary-care-framework
  sourceKey: source_artifact:who-brief-intervention-hazardous-harmful-drinking-2001-08-05
  findingKind: context
  population: People in primary care whose alcohol consumption has become hazardous or harmful.
  exposure: AUDIT-informed brief intervention and primary-care counseling framework.
  outcome: hazardous drinking identification; harmful drinking counseling; reduction or cessation advice
  summary: WHO describes an AUDIT-informed primary-care brief-intervention framework for hazardous and harmful drinking; it supports screening/referral context but does not test abstinence challenges.
  evidenceUse:
  - context
  - safety
murphV1Priority: High
pdfRightsStatus: permission_required
---


This source is included for **Alcohol-reduction comparator reviews and public-health guideline context**.

**Findings:** The manual provides techniques for short-term primary-care interventions intended to help risky drinkers reduce or cease alcohol consumption and avoid harms; it is not a trial or effect-estimate source.

**Why it matters:** Useful for framing screening, brief advice, and referral, especially for higher-risk drinking patterns.

**Potential experiment signals:** AUDIT score, hazardous drinking flag, referral threshold.

**Protocol takeaway:** Use as guideline context for screening/referral boundaries; not direct efficacy evidence.

**Claim use:** `context-only`.

**Directness:** `general_guideline`.

**Population mismatch:** Primary-care hazardous/harmful drinking context may include patients requiring clinical support, not wellness self-experimentation.

**Limitations and safety notes:** Manual/guideline source, not direct evidence for a self-directed abstinence challenge. Designed to support appropriate primary-care response to hazardous or harmful drinking; not an adverse-event study.
