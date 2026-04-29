---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-eating-disorders-ng69-2020-12-16
slug: sources/prolonged-fasting/nice-eating-disorders-ng69-2020-12-16
title: 'Eating disorders: recognition and treatment'
summary: NICE NG69 provides recognition and treatment guidance for suspected or confirmed eating disorders and supports referral when ED risk is present.
status: draft
quality: usable
aliases:
- National Institute for Health and Care Excellence 2017
- 'Eating disorders: recognition and treatment'
categories:
- prolonged-fasting
- eating-disorder-risk
- restriction-risk
relations:
- type: related_protocol
  target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
- type: parent_family
  target: experiment_family:prolonged-fasting
source:
  kind: guideline
  title: 'Eating disorders: recognition and treatment'
  authors: National Institute for Health and Care Excellence
  year: 2017
  journal: NICE Guideline NG69
  citation: 'National Institute for Health and Care Excellence. Eating disorders: recognition and treatment. NICE Guideline NG69. 2017.'
  url: https://nice.org.uk/guidance/ng69
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 4cce59253ffae56f75af29f9f33aace58bd91658e9ce58ac9037dd73ae2c7c20
    url: https://nice.org.uk/guidance/ng69
  canonicalUrl: https://nice.org.uk/guidance/ng69
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline or position paper
  populationLabel: People with suspected or confirmed eating disorders
  durationLabel: NICE guideline NG69; first published 2017, updated 16 Dec 2020
  aggregateRole: synthesis
  cohortKey: nice-eating-disorders-ng69-2020-12-16
evidenceBucket: eating-disorder and restriction-risk boundary
whyItMatters: Authoritative guideline for recognition, assessment, and treatment/referral; useful as a conservative safety anchor for fasting exclusions.
potentialMurphEndpoints:
- screening and contraindications
- referral boundaries
- medical instability
protocolTakeaway: A fasting protocol should not proceed when suspected ED features require clinical assessment.
murphTakeaway: A fasting protocol should not proceed when suspected ED features require clinical assessment.
studyDesign: Clinical guideline or position paper
modality: Recognition and treatment guidance
claimUse: safety-only
interventionOrExposure: Recognition and treatment guidance
comparatorOrControl: Not applicable
endpoints:
- screening and contraindications
- referral boundaries
- medical instability
effectEstimatesOrDirection: Guideline covers recognition and treatment of eating disorders, including assessment/referral pathways for suspected or confirmed EDs.
adverseEventsOrSafetyNotes: Safety-only source for referral and contraindication language when ED risk is present.
limitations: General eating-disorder guideline; does not test fasting protocols.
populationMismatch: Clinical guideline for ED recognition/treatment, not prolonged-fasting intervention evidence.
directnessToProtocol: safety_boundary
sourceFindings:
- findingId: finding:nice-eating-disorders-ng69-2020-12-16-restriction-risk
  sourceKey: source_artifact:nice-eating-disorders-ng69-2020-12-16
  extractedFromArtifactId: art_nice_eating_disorders_ng69_2020_12_16
  findingKind: safety
  population: People with suspected or confirmed eating disorders
  exposure: Recognition and treatment guidance
  outcome: screening and contraindications; referral boundaries; medical instability
  summary: NICE NG69 provides recognition and treatment guidance for suspected or confirmed eating disorders and supports referral when ED risk is present.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: permission_required
---

This source is included for **eating-disorder and restriction-risk boundary**.

**Findings:** NICE NG69 provides recognition and treatment guidance for suspected or confirmed eating disorders and supports referral when ED risk is present.

**Why it matters:** Authoritative guideline for recognition, assessment, and treatment/referral; useful as a conservative safety anchor for fasting exclusions.

**Potential experiment signals:** screening and contraindications, referral boundaries, medical instability.

**Protocol takeaway:** A fasting protocol should not proceed when suspected ED features require clinical assessment.

**Claim use:** `safety-only`.

**Directness and caveat:** Clinical guideline for ED recognition/treatment, not prolonged-fasting intervention evidence. General guideline, not fasting-specific evidence.
