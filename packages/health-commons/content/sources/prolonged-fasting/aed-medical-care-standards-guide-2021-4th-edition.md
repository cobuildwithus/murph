---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:aed-medical-care-standards-guide-2021-4th-edition
slug: sources/prolonged-fasting/aed-medical-care-standards-guide-2021-4th-edition
title: 'Eating Disorders: A Guide to Medical Care — AED Report 2021, 4th Edition'
summary: The AED medical-care guide is a professional standards source for medical assessment and care of people with eating disorders.
status: draft
quality: usable
aliases:
  - Academy for Eating Disorders Medical Care Standards Committee 2021
  - 'Eating Disorders: A Guide to Medical Care — AED Report 2021, 4th Edition'
categories:
  - prolonged-fasting
  - eating-disorder-risk
  - restriction-risk
relations:
  -
    type: related_protocol
    target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
  -
    type: parent_family
    target: experiment_family:prolonged-fasting
source:
  kind: guideline
  title: 'Eating Disorders: A Guide to Medical Care — AED Report 2021, 4th Edition'
  authors: Academy for Eating Disorders Medical Care Standards Committee
  year: 2021
  journal: Academy for Eating Disorders
  citation: 'Academy for Eating Disorders Medical Care Standards Committee. Eating Disorders: A Guide to Medical Care — AED Report 2021, 4th Edition. Academy for Eating Disorders. 2021.'
  url: https://aedweb.org/resources/publications/medical-care-standards
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 9e9b7eecf1643f2747cdd584a471dc7ea594aca0bd0c765feaf2decaec939944
    url: https://aedweb.org/resources/publications/medical-care-standards
  canonicalUrl: https://aedweb.org/resources/publications/medical-care-standards
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline or position paper
  populationLabel: People with suspected or confirmed eating disorders
  durationLabel: 2021 AED medical-care standards guide, 4th edition
  aggregateRole: synthesis
  cohortKey: aed-medical-care-standards-guide-2021-4th-edition
evidenceBucket: eating-disorder and restriction-risk boundary
whyItMatters: Practical medical-care guide emphasizing recognition, medical workup, stabilization thresholds, and referral; useful for escalation language.
potentialMurphEndpoints:
  - screening and contraindications
  - medical instability
  - referral boundaries
protocolTakeaway: Do not enroll people with active/suspected ED signs without clinical evaluation.
murphTakeaway: Do not enroll people with active/suspected ED signs without clinical evaluation.
studyDesign: Clinical guideline or position paper
modality: Medical care standards for eating disorders
claimUse: safety-only
interventionOrExposure: Medical care standards for eating disorders
comparatorOrControl: Not applicable
endpoints:
  - screening and contraindications
  - medical instability
  - referral boundaries
effectEstimatesOrDirection: Medical-care standards guide for people with suspected or confirmed eating disorders; included for medical-instability and referral boundaries.
adverseEventsOrSafetyNotes: Safety-only clinical standards source for ED medical risk and referral logic.
limitations: Professional guide; not fasting-specific and rights status requires permission for PDF redistribution.
populationMismatch: Clinical ED care standards, not fasting intervention evidence.
directnessToProtocol: safety_boundary
sourceFindings:
  -
    findingId: finding:aed-medical-care-standards-guide-2021-4th-edition-restriction-risk
    sourceKey: source_artifact:aed-medical-care-standards-guide-2021-4th-edition
    extractedFromArtifactId: art_aed_medical_care_standards_guide_2021_4th_edition
    findingKind: safety
    population: People with suspected or confirmed eating disorders
    exposure: Medical care standards for eating disorders
    outcome: screening and contraindications; medical instability; referral boundaries
    summary: The AED medical-care guide is a professional standards source for medical assessment and care of people with eating disorders.
    evidenceUse:
      - safety
murphV1Priority: High
pdfRightsStatus: permission_required
---

This source is included for **eating-disorder and restriction-risk boundary**.

**Findings:** The AED medical-care guide is a professional standards source for medical assessment and care of people with eating disorders.

**Why it matters:** Practical medical-care guide emphasizing recognition, medical workup, stabilization thresholds, and referral; useful for escalation language.

**Potential experiment signals:** screening and contraindications, medical instability, referral boundaries.

**Protocol takeaway:** Do not enroll people with active/suspected ED signs without clinical evaluation.

**Claim use:** `safety-only`.

**Directness and caveat:** Clinical ED care standards, not fasting intervention evidence. Guideline source; no protocol efficacy claim.
