---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-j.drugalcdep.2019.05.030
slug: sources/alcohol-abstinence/doi-10.1016-j.drugalcdep.2019.05.030
title: 'Heart rate variability as a potential biomarker for alcohol use disorders: A systematic review and meta-analysis'
summary: This HRV meta-analysis supports reduced HRV as an AUD-associated autonomic biomarker, useful for cardiovascular/autonomic safety context but not for causal claims about 7-, 14-, or 30-day abstinence challenges.
status: draft
quality: usable
aliases:
- source_artifact:doi-10.1016-j.drugalcdep.2019.05.030
- doi-10.1016-j.drugalcdep.2019.05.030
- DOI 10.1016/j.drugalcdep.2019.05.030
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
  title: 'Heart rate variability as a potential biomarker for alcohol use disorders: A systematic review and meta-analysis'
  authors: Ying-Chih Cheng; Yu-Chen Huang; Wei-Lieh Huang
  year: 2019
  journal: Drug and Alcohol Dependence
  citation: 'Ying-Chih Cheng; Yu-Chen Huang; Wei-Lieh Huang. Heart rate variability as a potential biomarker for alcohol use disorders: A systematic review and meta-analysis. Drug and Alcohol Dependence. 2019. doi:10.1016/j.drugalcdep.2019.05.030.'
  doi: 10.1016/j.drugalcdep.2019.05.030
  url: https://www.sciencedirect.com/science/article/abs/pii/S0376871619302010
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1016/j.drugalcdep.2019.05.030
    titleHash: 31b737a1fa6d9b1a4c4893a8300d7ce073be55f95149dba2b7a76f3cde662464
    url: https://www.sciencedirect.com/science/article/abs/pii/S0376871619302010
  canonicalUrl: https://www.sciencedirect.com/science/article/abs/pii/S0376871619302010
researchEvidence:
  designKind: meta_analysis
  designLabel: meta analysis
  participantCount: 15
  participantCountKind: reported
  populationLabel: Adults with alcohol use disorder compared with healthy participants in HRV studies.
  durationLabel: Systematic review/meta-analysis of HRV studies; abstinence-challenge duration not applicable.
  aggregateRole: synthesis
  cohortKey: doi-10.1016-j.drugalcdep.2019.05.030
  notes:
  - 'source-index.json absent in supplied snapshot; identity checked against fallback content/sources inventory; candidate shard 06-discovery-sleep-autonomic-wearables; discovery directness guess(es): safety_boundary; discovery claim-use guess(es): safety-only; discovery relevance guess(es): medium; candidate rationale: Meta-analysis of HRV as an AUD biomarker; useful safety/population-mismatch context.'
evidenceBucket: clinical supervised abstinence, AUD, or liver-disease context
whyItMatters: Meta-analysis of HRV as an AUD biomarker; useful safety/population-mismatch context.
potentialMurphEndpoints:
- heart rate variability
- parasympathetic HRV
- RMSSD
- high-frequency HRV
- autonomic dysfunction
protocolTakeaway: HRV can be monitored as an autonomic signal, but this source does not establish short-challenge efficacy.
murphTakeaway: Use to frame HRV as a clinically meaningful but population-mismatched measurement signal. The exposure is AUD status, not a randomized or self-directed short abstinence intervention.
studyDesign: meta analysis
modality: Clinical supervised abstinence, AUD detox, and liver-disease biomarker context
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/doi-10.1016-j.drugalcdep.2019.05.030-aud-hrv-meta-analysis
  sourceKey: source_artifact:doi-10.1016-j.drugalcdep.2019.05.030
  extractedFromArtifactId: art_doi_10_1016_j_drugalcdep_2019_05_030
  findingKind: measurement_validation
  population: Adults with alcohol use disorder compared with healthy participants in HRV studies.
  exposure: Alcohol use disorder status in studies measuring heart-rate variability.
  outcome: heart rate variability, parasympathetic HRV, RMSSD, high-frequency HRV, autonomic dysfunction
  summary: This HRV meta-analysis supports reduced HRV as an AUD-associated autonomic biomarker, useful for cardiovascular/autonomic safety context but not for causal claims about 7-, 14-, or 30-day abstinence challenges.
  evidenceUse:
  - measurement
  - safety
  - context
murphV1Priority: Medium
pdfRightsStatus: paywalled
population: Adults with alcohol use disorder compared with healthy participants in HRV studies.
interventionOrExposure: Alcohol use disorder status in studies measuring heart-rate variability.
comparatorOrControl: Healthy control participants.
durationOrFollowUp: Systematic review/meta-analysis of HRV studies; abstinence-challenge duration not applicable.
endpoints:
- heart rate variability
- parasympathetic HRV
- RMSSD
- high-frequency HRV
- autonomic dysfunction
effectEstimatesOrDirection: Systematic review/meta-analysis found lower HRV in AUD populations than healthy controls; available abstracts report 15 quantitative studies and lower parasympathetic/total-variability indices including RMSSD, with HF findings less consistent.
adverseEventsOrSafetyNotes: AUD autonomic biomarker context; lower HRV in AUD should not be reframed as a direct effect of a short abstinence challenge.
limitations:
- Meta-analysis is about AUD status, not assigned short-term abstinence.
- Study populations, HRV methods, and medication/treatment states vary.
- Ledger did not carry a PMID for this DOI-keyed source; source key retained as DOI-only.
populationMismatch: AUD participants and clinical comparisons, not general low-risk challenge participants.
directnessToProtocol: clinical_supervised
claimUseBoundary: safety-only. The exposure is AUD status, not a randomized or self-directed short abstinence intervention.
artifactCandidates:
- art_doi_10_1016_j_drugalcdep_2019_05_030
---


This source is included for **Clinical supervised abstinence, AUD detox, and liver-disease biomarker context**.

**Findings:** This HRV meta-analysis supports reduced HRV as an AUD-associated autonomic biomarker, useful for cardiovascular/autonomic safety context but not for causal claims about 7-, 14-, or 30-day abstinence challenges.

**Why it matters:** Meta-analysis of HRV as an AUD biomarker; useful safety/population-mismatch context.

**Potential experiment signals:** heart rate variability, parasympathetic HRV, RMSSD, high-frequency HRV, autonomic dysfunction.

**Protocol takeaway:** HRV can be monitored as an autonomic signal, but this source does not establish short-challenge efficacy.

**Claim use:** `safety-only`.
