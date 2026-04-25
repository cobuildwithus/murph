---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01880463-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct01880463-2026-04-25
title: Dry Eye Disease in the Vitamin D and Omega-3 Trial (VITAL)
summary: Registry record for the VITAL dry-eye ancillary study, documenting prevention-focused aims for omega-3 and vitamin D3 in the VITAL population.
status: draft
quality: usable
aliases:
- Dry Eye Disease in the Vitamin D and Omega-3 Trial (VITAL)
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
source:
  kind: other
  title: Dry Eye Disease in the Vitamin D and Omega-3 Trial (VITAL)
  authors: ClinicalTrials.gov; Brigham and Women's Hospital
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Dry Eye Disease in the Vitamin D and Omega-3 Trial (VITAL). NCT01880463. Accessed 2026-04-25.
  url: https://clinicaltrials.gov/study/NCT01880463
researchEvidence:
  designKind: other
  designLabel: Trial registry record
  populationLabel: VITAL trial participants in a dry-eye ancillary prevention/natural-history study.
  durationLabel: Parent VITAL intervention period was approximately five years; exact ancillary follow-up not independently extracted here.
  aggregateRole: context
  cohortKey: healthy-adult-dry-eye-prevention-registry
populationMismatch: Registry/design context for prevention and natural history; not a dry-eye treatment trial result.
evidenceBucket: dry_eye_treatment_prevention
whyItMatters: It documents that the VITAL dry-eye question was prevention/natural history, not treatment of established DED.
potentialMurphEndpoints:
- incident dry-eye diagnosis
- dry-eye symptom reports
- quality of life
- effect modifiers
protocolTakeaway: Use as registry context only.
murphTakeaway: Registry aims can guide endpoint taxonomy but should not be treated as findings.
studyDesign: trial_registry
modality: trial registry
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
---
This source is included for **dry_eye_treatment_prevention**.

**Findings:** Population: VITAL trial participants in a dry-eye ancillary prevention/natural-history study. Intervention/exposure: Omega-3 fatty acid supplementation and vitamin D3 within the VITAL ancillary design. Comparator/control: Placebo factors within the parent VITAL trial. Duration/follow-up: Parent VITAL intervention period was approximately five years; exact ancillary follow-up not independently extracted here. Endpoints: dry-eye incidence, dry-eye symptoms, quality of life impact, natural history, effect modification. Effect/direction: Not efficacy evidence; registry aims included testing whether omega-3 supplementation reduced dry-eye incidence and improved natural history/symptoms. Safety/adverse events: No adverse-event finding extracted from registry record.

**Why it matters:** It documents that the VITAL dry-eye question was prevention/natural history, not treatment of established DED.

**Potential experiment signals:** incident dry-eye diagnosis, dry-eye symptom reports, quality of life, effect modifiers.

**Protocol takeaway:** Use as registry context only.

**Limitations and population mismatch:** Registry record is design/administrative evidence only.; No effect estimate should be taken from this source page; use the VITAL-Dry Eye publication for results. Population mismatch: Registry/design context for prevention and natural history; not a dry-eye treatment trial result.

**Claim use:** `context-only`.
