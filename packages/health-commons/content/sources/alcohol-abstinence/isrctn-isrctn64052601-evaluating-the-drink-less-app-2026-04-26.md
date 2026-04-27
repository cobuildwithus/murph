---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:isrctn-isrctn64052601-evaluating-the-drink-less-app-2026-04-26
slug: sources/alcohol-abstinence/isrctn-isrctn64052601-evaluating-the-drink-less-app-2026-04-26
title: Evaluating the Drink Less app to support alcohol reduction
summary: ISRCTN registry record for Drink Less app effectiveness trial, retained separately for pre-specified design, enrolment, eligibility, and endpoint context rather than efficacy synthesis.
status: draft
quality: usable
aliases:
- ISRCTN64052601
- Drink Less app ISRCTN registry
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
  kind: external_protocol
  title: Evaluating the effectiveness of the smartphone app Drink Less for the reduction of alcohol consumption among hazardous and harmful adult drinkers in the UK
  authors: ISRCTN Registry; University College London trial team
  year: 2020
  journal: ISRCTN Registry
  citation: 'ISRCTN Registry. ISRCTN64052601: Evaluating the effectiveness of the smartphone app Drink Less for the reduction of alcohol consumption among hazardous and harmful adult drinkers in the UK. Registry record accessed 2026-04-26.'
  url: https://www.isrctn.com/ISRCTN64052601
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: ISRCTN64052601
    titleHash: 5e86a64f64d4a3bae829a36e065f51670e32dccaa403148f470c69bee9870fc8
    url: https://www.isrctn.com/ISRCTN64052601
  canonicalUrl: https://www.isrctn.com/ISRCTN64052601
researchEvidence:
  designKind: expert_protocol
  designLabel: Prospective trial registry record for Drink Less app randomized controlled trial
  participantCount: 5602
  participantCountKind: approximate
  populationLabel: Adult hazardous and harmful drinkers in the UK who wanted to drink less and were eligible for the Drink Less trial.
  durationLabel: Registry endpoints include one-, three-, and six-month follow-up windows for alcohol outcomes.
  aggregateRole: primary
  cohortKey: isrctn64052601-drink-less-registry
evidenceBucket: alcohol-reduction comparator and reducer triage evidence
whyItMatters: Registry records protect against outcome switching and are useful for endpoint provenance, but the registry itself should not be used as an efficacy result when the publication exists separately.
potentialMurphEndpoints:
- weekly alcohol consumption
- AUDIT hazardous-drinking status
- one-month follow-up
- three-month follow-up
- six-month follow-up
- trial enrolment
protocolTakeaway: Use as endpoint/protocol context for the Drink Less trial only; cite the journal result source for efficacy and safety findings.
murphTakeaway: Useful for designing and auditing digital-intervention endpoint timing, not for claims that short abstinence variants work.
studyDesign: Trial registry record for a two-arm Drink Less versus NHS alcohol advice webpage randomized trial.
modality: trial registry / digital alcohol-reduction protocol
claimUse: context-only
sourceFindings:
-
  findingId: finding:isrctn-isrctn64052601-evaluating-the-drink-less-app-2026-04-26-registry-identifies-endpoints
  sourceKey: source_artifact:isrctn-isrctn64052601-evaluating-the-drink-less-app-2026-04-26
  extractedFromArtifactId: art_isrctn_isrctn64052601_evaluating_the_drink_less_app_2026_04_26
  findingKind: context
  population: Adults eligible for the Drink Less effectiveness trial.
  exposure: Drink Less app versus NHS alcohol advice webpage comparator as registered.
  outcome: Pre-specified alcohol-reduction endpoints and follow-up timing.
  summary: The registry record links ISRCTN64052601 to Drink Less app evaluation and identifies eligibility, enrolment, and planned alcohol-consumption follow-up windows.
  evidenceUse:
  - context
  - measurement
-
  findingId: finding:isrctn-isrctn64052601-evaluating-the-drink-less-app-2026-04-26-not-efficacy-source
  sourceKey: source_artifact:isrctn-isrctn64052601-evaluating-the-drink-less-app-2026-04-26
  extractedFromArtifactId: art_isrctn_isrctn64052601_evaluating_the_drink_less_app_2026_04_26
  findingKind: context
  population: Drink Less registry record.
  exposure: Trial registration metadata.
  outcome: Claim-use boundary.
  summary: Because a peer-reviewed outcome publication is available separately, this registry should be used for protocol provenance and endpoint auditing rather than efficacy effect estimates.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---


This source is included for **Alcohol-reduction comparator trials, digital interventions, and liver-focused protocols**.

**Findings:**
- `finding:isrctn-isrctn64052601-evaluating-the-drink-less-app-2026-04-26-registry-identifies-endpoints` — The registry record links ISRCTN64052601 to Drink Less app evaluation and identifies eligibility, enrolment, and planned alcohol-consumption follow-up windows.
- `finding:isrctn-isrctn64052601-evaluating-the-drink-less-app-2026-04-26-not-efficacy-source` — Because a peer-reviewed outcome publication is available separately, this registry should be used for protocol provenance and endpoint auditing rather than efficacy effect estimates.

**Why it matters:** Registry records protect against outcome switching and are useful for endpoint provenance, but the registry itself should not be used as an efficacy result when the publication exists separately.

**Potential experiment signals:** weekly alcohol consumption, AUDIT hazardous-drinking status, one-month follow-up, three-month follow-up, six-month follow-up, trial enrolment.

**Protocol takeaway:** Use as endpoint/protocol context for the Drink Less trial only; cite the journal result source for efficacy and safety findings.

**Claim use:** `context-only`.

**Limitations and population mismatch:** Registry source rather than outcome paper; registry page access may change; efficacy and adverse-event claims should be taken from the publication, not inferred from registration metadata.

**Artifact candidates and rights:** `art_isrctn_isrctn64052601_evaluating_the_drink_less_app_2026_04_26` is a metadata-only artifact candidate. `pdfRightsStatus` is `unknown`; do not commit copyrighted PDFs unless the specific file license is verified as redistributable.
