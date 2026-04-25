---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct00970489-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct00970489-2026-04-25
title: Omega-3 Fatty Acids for Prevention of Post-Operative Atrial Fibrillation
summary: ClinicalTrials.gov registry anchor for the OPERA perioperative fish-oil trial, documenting the cardiac-surgery AF-prevention population and high-loading-dose regimen.
status: draft
quality: usable
aliases:
- Omega-3 Fatty Acids for Prevention of Post-Operative Atrial Fibrillation
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
  title: Omega-3 Fatty Acids for Prevention of Post-Operative Atrial Fibrillation
  authors: ClinicalTrials.gov / study sponsor investigators
  year: 2026
  journal: ClinicalTrials.gov
  citation: 'ClinicalTrials.gov. NCT00970489: Omega-3 Fatty Acids for Prevention of Post-Operative Atrial Fibrillation. Accessed for source extraction 2026-04-25.'
  url: https://clinicaltrials.gov/study/NCT00970489
researchEvidence:
  designKind: other
  designLabel: Clinical trial registry record
  participantCount: 1516
  participantCountKind: reported
  populationLabel: Adults undergoing cardiac surgery in the OPERA trial context.
  durationLabel: 10 g over 3-5 days or 8 g over 2 days before surgery, then 2 g/day until hospital discharge or postoperative day 10.
  aggregateRole: primary
  cohortKey: batch-012:clinicaltrials-nct00970489-2026-04-25
evidenceBucket: safety_adverse_events
whyItMatters: Useful for dose/population boundary and trial provenance.
potentialMurphEndpoints:
- adverse_event:postoperative-atrial-fibrillation
- dose:loading-dose
- registry:clinicaltrials-gov
protocolTakeaway: 'Use as safety-only evidence only: Registry record anchors the intervention and trial design; outcome results should be extracted from the OPERA publication rather than the registry page.'
murphTakeaway: Useful for dose/population boundary and trial provenance.
studyDesign: other
modality: oral EPA/DHA supplementation or adjacent omega-3 fatty-acid product
claimUse: safety-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **safety_adverse_events**.

**Findings:** Registry record anchors the intervention and trial design; outcome results should be extracted from the OPERA publication rather than the registry page.

**Why it matters:** Useful for dose/population boundary and trial provenance.

**Potential experiment signals:** adverse_event:postoperative-atrial-fibrillation, dose:loading-dose, registry:clinicaltrials-gov.

**Protocol takeaway:** Use as safety-only evidence only: Registry record anchors the intervention and trial design; outcome results should be extracted from the OPERA publication rather than the registry page.

**Claim use:** `safety-only`.

**Population mismatch:** Perioperative cardiac-surgery protocol with loading dose, not routine oral EPA/DHA supplementation.

**Limitations:** Registry record is not the peer-reviewed outcome source; some fields may be historical or updated over time.
