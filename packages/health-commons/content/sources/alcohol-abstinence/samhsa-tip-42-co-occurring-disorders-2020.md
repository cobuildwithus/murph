---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:samhsa-tip-42-co-occurring-disorders-2020
slug: sources/alcohol-abstinence/samhsa-tip-42-co-occurring-disorders-2020
title: 'Substance Use Disorder Treatment for People With Co-Occurring Disorders: Updated 2020'
summary: Major public-domain clinical guidance for mental-health comorbidity as a boundary requiring integrated care.
status: draft
quality: usable
aliases:
- source_artifact:samhsa-tip-42-co-occurring-disorders-2020
- samhsa-tip-42-co-occurring-disorders-2020
- candidate:medications-pregnancy-liver-mental-health:031
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
  kind: guideline
  title: 'Substance Use Disorder Treatment for People With Co-Occurring Disorders: Updated 2020'
  authors: Substance Abuse and Mental Health Services Administration
  year: 2020
  journal: SAMHSA Treatment Improvement Protocol Series No. 42; NCBI Bookshelf
  citation: 'Substance Abuse and Mental Health Services Administration. Substance Use Disorder Treatment for People With Co-Occurring Disorders: Updated 2020. SAMHSA Treatment Improvement Protocol Series No. 42; NCBI Bookshelf. 2020'
  url: https://www.ncbi.nlm.nih.gov/books/NBK571020
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: e73d823a26b1586678b7cd32d66d2e841acf3f864898b7fbc5d17efa5c5e37cf
    url: https://www.ncbi.nlm.nih.gov/books/NBK571020
  canonicalUrl: https://www.ncbi.nlm.nih.gov/books/NBK571020
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline / recommendation
  populationLabel: People with co-occurring substance use and mental disorders
  durationLabel: Clinical treatment guidance; no challenge duration.
  aggregateRole: synthesis
  cohortKey: samhsa-tip-42-co-occurring-disorders-2020
  notes:
  - Protocol-specific interpretation belongs to standalone evidence appraisal records, not source-page efficacy fields.
  - Directness and population mismatch are preserved for protocol synthesis.
evidenceBucket: medication, pregnancy, liver disease, and mental-health safety boundary
whyItMatters: Major public-domain clinical guidance for mental-health comorbidity as a boundary requiring integrated care.
potentialMurphEndpoints:
- safety
- mental health boundary
protocolTakeaway: Use for mental-health escalation and integrated-care boundaries only.
murphTakeaway: Use for mental-health escalation and integrated-care boundaries only.
studyDesign: Clinical guideline / recommendation
modality: Co-occurring disorders treatment guidance
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/samhsa-tip-42-co-occurring-disorders-2020
  sourceKey: source_artifact:samhsa-tip-42-co-occurring-disorders-2020
  extractedFromArtifactId: art_samhsa-tip-42-co-occurring-disorders-2020
  findingKind: safety
  population: People with co-occurring substance use and mental disorders
  exposure: Screening, assessment, diagnosis, and integrated treatment for co-occurring disorders
  outcome: safety, mental health boundary
  summary: SAMHSA TIP 42 supports mental-health and co-occurring-disorder boundaries, emphasizing assessment and integrated treatment rather than self-guided challenge framing.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
interventionOrExposure: Screening, assessment, diagnosis, and integrated treatment for co-occurring disorders
comparatorOrControl: Not applicable.
durationOrFollowUp: Clinical treatment guidance; no challenge duration.
endpoints:
- safety
- mental health boundary
effectEstimatesOrDirection: No challenge efficacy estimate. TIP 42 covers integrated treatment for co-occurring substance use and mental disorders.
adverseEventsOrSafetyNotes: Co-occurring substance use and mental disorders require screening and integrated care pathways.
limitations:
- Not a direct trial of self-guided 7-, 14-, or 30-day alcohol-free variants.
- Use is limited to safety, clinical context, measurement context, or adjacent-variant interpretation.
populationMismatch: People with co-occurring substance use and mental disorders differs from generally healthy community participants considering a short alcohol-free challenge.
directnessToProtocol: general_guideline
claimUseBoundary: Safety/context boundary. This source should not be promoted into direct protocol efficacy claims unless a future synthesis explicitly labels it as adjacent evidence.
artifactCandidates:
- art_samhsa-tip-42-co-occurring-disorders-2020
---


This source is included for **Medication, pregnancy, liver disease, and mental-health safety boundaries (part 1)**.

**Findings:** SAMHSA TIP 42 supports mental-health and co-occurring-disorder boundaries, emphasizing assessment and integrated treatment rather than self-guided challenge framing.

**Why it matters:** Major public-domain clinical guidance for mental-health comorbidity as a boundary requiring integrated care.

**Potential experiment signals:** safety, mental health boundary.

**Protocol takeaway:** Use for mental-health escalation and integrated-care boundaries only.

**Claim use:** `safety-only`.
