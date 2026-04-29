---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:trialx-fastomics-prolonged-fasting-2025-10-21
slug: sources/prolonged-fasting/trialx-fastomics-prolonged-fasting-2025-10-21
title: 'Fastomics: Metabolic and Therapeutic Effects of Prolonged Fasting'
summary: The Fastomics registry listing explicitly excludes active ED concern, ED history, low body weight, hypoglycemia/contraindications, pregnancy, and other risks from a prolonged-fasting study.
status: draft
quality: usable
aliases:
- University of Minnesota 2025
- 'Fastomics: Metabolic and Therapeutic Effects of Prolonged Fasting'
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
  kind: external_protocol
  title: 'Fastomics: Metabolic and Therapeutic Effects of Prolonged Fasting'
  authors: University of Minnesota
  year: 2025
  journal: Clinical trial registry listing (NCT07216989)
  citation: 'University of Minnesota. Fastomics: Metabolic and Therapeutic Effects of Prolonged Fasting. Clinical trial registry listing (NCT07216989). 2025.'
  url: https://trialx.com/clinical-trials/listings/325171/fastomics-metabolic-and-therapeutic-effects-of-prolonged-fasting
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT07216989
    titleHash: fcd7485371ae4434dd0132f1071d17ad5bd91bec9cde8030d1e473e5b612bad8
    url: https://trialx.com/clinical-trials/listings/325171/fastomics-metabolic-and-therapeutic-effects-of-prolonged-fasting
  canonicalUrl: https://trialx.com/clinical-trials/listings/325171/fastomics-metabolic-and-therapeutic-effects-of-prolonged-fasting
researchEvidence:
  designKind: expert_protocol
  designLabel: External protocol or registry listing
  populationLabel: Adults aged 18 to 65 years with BMI 18.5 to 29.9 in a prolonged-fasting study
  durationLabel: Registry/protocol listing modified 2025-10-21
  aggregateRole: primary
  cohortKey: trialx-fastomics-prolonged-fasting-2025-10-21
evidenceBucket: eating-disorder and restriction-risk boundary
whyItMatters: External prolonged-fasting protocol listing explicitly excludes active eating-disorder concerns, self-reported eating-disorder history, contraindications, and low body weight; useful as boundary evidence, not as efficacy evidence.
potentialMurphEndpoints:
- screening and contraindications
- eating-disorder exclusion
- underweight boundary
- medical supervision
protocolTakeaway: Mirror ED-history, active-screening, low-body-weight, hypoglycemia, and medical-contraindication gates in protocol safety language.
murphTakeaway: Mirror ED-history, active-screening, low-body-weight, hypoglycemia, and medical-contraindication gates in protocol safety language.
studyDesign: External protocol or registry listing
modality: Prolonged fasting study protocol
claimUse: safety-only
interventionOrExposure: Prolonged fasting study protocol
comparatorOrControl: Not applicable; external protocol eligibility criteria
endpoints:
- screening and contraindications
- eating-disorder exclusion
- underweight boundary
- medical supervision
effectEstimatesOrDirection: Trial listing excludes active eating-disorder concern by questionnaire, self-reported eating-disorder history, hypoglycemia/prolonged-fasting contraindications, pregnancy, low body weight, and other medical risks.
adverseEventsOrSafetyNotes: 'Direct external protocol safety boundary: ED history/active concern and low body weight are explicit exclusions.'
limitations: Trial registry/listing; no outcomes available in this extraction; eligibility claims only.
populationMismatch: External research protocol; no efficacy or adverse-event results yet.
directnessToProtocol: direct_protocol
sourceFindings:
- findingId: finding:trialx-fastomics-prolonged-fasting-2025-10-21-restriction-risk
  sourceKey: source_artifact:trialx-fastomics-prolonged-fasting-2025-10-21
  extractedFromArtifactId: art_trialx_fastomics_prolonged_fasting_2025_10_21
  findingKind: safety
  population: Adults aged 18 to 65 years with BMI 18.5 to 29.9 in a prolonged-fasting study
  exposure: Prolonged fasting study protocol
  outcome: screening and contraindications; eating-disorder exclusion; underweight boundary; medical supervision
  summary: The Fastomics registry listing explicitly excludes active ED concern, ED history, low body weight, hypoglycemia/contraindications, pregnancy, and other risks from a prolonged-fasting study.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **eating-disorder and restriction-risk boundary**.

**Findings:** The Fastomics registry listing explicitly excludes active ED concern, ED history, low body weight, hypoglycemia/contraindications, pregnancy, and other risks from a prolonged-fasting study.

**Why it matters:** External prolonged-fasting protocol listing explicitly excludes active eating-disorder concerns, self-reported eating-disorder history, contraindications, and low body weight; useful as boundary evidence, not as efficacy evidence.

**Potential experiment signals:** screening and contraindications, eating-disorder exclusion, underweight boundary, medical supervision.

**Protocol takeaway:** Mirror ED-history, active-screening, low-body-weight, hypoglycemia, and medical-contraindication gates in protocol safety language.

**Claim use:** `safety-only`.

**Directness and caveat:** External research protocol; no efficacy or adverse-event results yet. Eligibility criteria only; no trial outcome evidence.
