---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1186-s13102-019-0138-4
slug: sources/intermittent-pneumatic-compression/doi-10.1186-s13102-019-0138-4
title: "Disrupting prolonged sitting reduces IL-8 and lower leg swell in active young adults"
summary: "Prolonged standing/sitting and workday leg swelling sibling variant source for the pneumatic compression pants research package. Role: context-only; directness: adjacent_variant. Sibling prolonged-standing/sitting swelling context; not sports-recovery efficacy."
status: draft
quality: usable
aliases:
  - "PMC6798359"
  - "10.1186/s13102-019-0138-4"
categories:
  - intermittent-pneumatic-compression
relations:

  -
    type: related_protocol
    target: protocol_variant:intermittent-pneumatic-compression/pneumatic-compression-pants
  -
    type: parent_family
    target: experiment_family:intermittent-pneumatic-compression
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: "PMC6798359"
    doi: "10.1186/s13102-019-0138-4"
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6798359/"
  canonicalUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6798359/"
source:
  kind: journal_article
  title: "Disrupting prolonged sitting reduces IL-8 and lower leg swell in active young adults"
  doi: "10.1186/s13102-019-0138-4"
  url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6798359/"
researchEvidence:
  designKind: crossover_trial
  designLabel: "crossover"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Prolonged standing/sitting and workday leg swelling sibling variant"
directness: "adjacent_variant"
claimUse: "context-only"
murphV1Priority: "medium"
pdfRightsStatus: "open_access"
---

This source is included for **Prolonged standing/sitting and workday leg swelling sibling variant**.

**Findings:** Eligible participants completed 4 h uninterrupted sitting and 4 h sitting disrupted by 3 min of cycling each hour. Salivary IL-8 increased in prolonged sitting but decreased in disrupted sitting, and lower-leg swelling was attenuated during disrupted sitting. This is movement-break evidence, not compression evidence.

**Why it matters:** The source helps separate a swelling endpoint caused by sitting from any compression-pants mechanism.

**Potential experiment signals:** biomarker / lower-leg-swell, biomarker / salivary-il-8, biomarker / heart-rate, biomarker / blood-pressure.

**Protocol takeaway:** Use only as adjacent sitting-context evidence for endpoints and confounders.

**Claim use:** `context-only`.
