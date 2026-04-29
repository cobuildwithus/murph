---
schemaVersion: 'murph.commons.page.v1'
entityType: 'source_artifact'
key: 'source_artifact:pmcid-PMC8547489'
slug: 'sources/alcohol-abstinence/pmcid-PMC8547489'
title: 'Change in Alcohol Use and Association with Positive and Negative Emotions in Chronic Hepatitis C Patients'
summary: 'Mood/emotion context among liver-disease patients; not a primary intervention source.'
status: 'draft'
quality: 'usable'
aliases:
  - 'source_artifact:pmcid-PMC8547489'
  - 'pmcid-PMC8547489'
  - 'PMC8547489'
  - 'candidate:alcohol-reduction-comparators:047'
categories:
  - 'alcohol-abstinence'
relations:

  -
    type: 'related_protocol'
    target: 'protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence'
  -
    type: 'parent_family'
    target: 'experiment_family:alcohol-abstinence'
source:
  kind: 'journal_article'
  title: 'Change in Alcohol Use and Association with Positive and Negative Emotions in Chronic Hepatitis C Patients'
  authors: 'Sohail S; et al.'
  year: 2021
  journal: 'Journal article / PMC full text'
  citation: 'Sohail S; et al.. Change in Alcohol Use and Association with Positive and Negative Emotions in Chronic Hepatitis C Patients. Journal article / PMC full text. 2021. PMCID:PMC8547489.'
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8547489'
sourceIdentity:
  identityKind: 'scholarly_work'
  canonicalIdBasis: 'pmcid'
  identifiers:
    pmcid: 'PMC8547489'
    titleHash: 'c74f409928f5b7a8ab15269f3a95070b7d89009675631dd7548df64dd4ac427c'
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8547489'
  canonicalUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8547489'
researchEvidence:
  designKind: 'prospective_cohort'
  designLabel: 'Prospective cohort / observational study'
  participantCount: 174
  participantCountKind: 'reported'
  populationLabel: 'Patients with chronic hepatitis C in an alcohol-reduction context'
  durationLabel: 'Alcohol-use and emotion change assessed from baseline to 3, 6, and 12 months.'
  aggregateRole: 'primary'
  cohortKey: 'pmcid-PMC8547489'
  notes:
    - 'Protocol-specific interpretation belongs to standalone evidence appraisal records, not source-page efficacy fields.'
    - 'Directness and population mismatch are preserved for protocol synthesis.'
evidenceBucket: 'medication, pregnancy, liver disease, and mental-health safety boundary'
whyItMatters: 'Mood/emotion context among liver-disease patients; not a primary intervention source.'
potentialMurphEndpoints:
  - 'alcohol intake'
  - 'mood'
  - 'liver context'
protocolTakeaway: 'Use as adjacent mood/liver context only; do not infer causality for challenge users.'
murphTakeaway: 'Use as adjacent mood/liver context only; do not infer causality for challenge users.'
studyDesign: 'Prospective cohort / observational study'
modality: 'HCV alcohol-use and emotion change context'
claimUse: 'safety-only'
sourceFindings:

  -
    findingId: 'finding:alcohol-abstinence/pmcid-PMC8547489'
    sourceKey: 'source_artifact:pmcid-PMC8547489'
    extractedFromArtifactId: 'art_pmcid-PMC8547489'
    findingKind: 'context'
    population: 'Patients with chronic hepatitis C in an alcohol-reduction context'
    exposure: 'Observed alcohol-use change and emotion measures'
    outcome: 'alcohol intake, mood, liver context'
    summary: 'In chronic hepatitis C patients, alcohol-use decreases were associated with decreased negative emotions, providing adjacent mood context rather than direct challenge efficacy evidence.'
    evidenceUse:
      - 'context'
      - 'adjacent_variant'
murphV1Priority: 'Medium'
pdfRightsStatus: 'open_access'
interventionOrExposure: 'Observed alcohol-use change and emotion measures'
comparatorOrControl: 'Observed changes over time; no randomized abstinence challenge comparator extracted.'
durationOrFollowUp: 'Alcohol-use and emotion change assessed from baseline to 3, 6, and 12 months.'
endpoints:
  - 'alcohol intake'
  - 'mood'
  - 'liver context'
effectEstimatesOrDirection: 'In 174 chronic hepatitis C patients with alcohol use, extracted text reports that decreases in alcohol use were related to decreases in negative emotions across follow-up.'
adverseEventsOrSafetyNotes: 'Hepatitis C and alcohol-reduction treatment context differ from low-risk challenge participation.'
limitations:
  - 'Not a direct trial of self-guided 7-, 14-, or 30-day alcohol-free variants.'
  - 'Use is limited to safety, clinical context, measurement context, or adjacent-variant interpretation.'
populationMismatch: 'Patients with chronic hepatitis C in an alcohol-reduction context differs from generally healthy community participants considering a short alcohol-free challenge.'
directnessToProtocol: 'clinical_supervised'
claimUseBoundary: 'Safety/context boundary. This source should not be promoted into direct protocol efficacy claims unless a future synthesis explicitly labels it as adjacent evidence.'
artifactCandidates:
  - 'art_pmcid-PMC8547489'
---

This source is included for **Medication, pregnancy, liver disease, and mental-health safety boundaries (part 1)**.

**Findings:** In chronic hepatitis C patients, alcohol-use decreases were associated with decreased negative emotions, providing adjacent mood context rather than direct challenge efficacy evidence.

**Why it matters:** Mood/emotion context among liver-disease patients; not a primary intervention source.

**Potential experiment signals:** alcohol intake, mood, liver context.

**Protocol takeaway:** Use as adjacent mood/liver context only; do not infer causality for challenge users.

**Claim use:** `safety-only`.
