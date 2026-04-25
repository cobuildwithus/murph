---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01169259-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct01169259-2026-04-25
title: Vitamin D and Omega-3 Trial (VITAL)
summary: ClinicalTrials.gov registry anchor for VITAL.
status: draft
quality: usable
aliases:
- ClinicalTrials.gov NCT01169259
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
  title: Vitamin D and Omega-3 Trial (VITAL)
  authors: ClinicalTrials.gov; Brigham and Women's Hospital; National Cancer Institute
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov; Brigham and Women's Hospital; National Cancer Institute. Vitamin D and Omega-3 Trial (VITAL). ClinicalTrials.gov. 2026. Accessed 2026-04-25.
  url: https://clinicaltrials.gov/study/NCT01169259
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Rct
  participantCount: 25871
  participantCountKind: reported
  populationLabel: US men and women enrolled in the VITAL primary-prevention trial
  durationLabel: registry intervention phase median about 5.3 years in linked VITAL publications
  aggregateRole: context
  cohortKey: omega-3-supplementation:clinicaltrials-nct01169259-2026-04-25
evidenceBucket: cardiovascular_outcomes_boundary
whyItMatters: Keeps VITAL provenance explicit for later protocol references.
potentialMurphEndpoints:
- process:trial-registration
- condition:major-cardiovascular-event
protocolTakeaway: Use registry data to verify trial identity/design only.
murphTakeaway: Direct protocol registry anchor, not a finding source.
studyDesign: rct
modality: trial registry
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **cardiovascular_outcomes_boundary**.

**Findings:**
- **population / VITAL trial registry provenance:** Use to verify VITAL trial design/provenance only. Effect/direction: Registry anchor for 25,871-person VITAL factorial trial of vitamin D3 and marine omega-3 supplements.

**Why it matters:** Keeps VITAL provenance explicit for later protocol references.

**Potential experiment signals:**
- cardiovascular disease
- cancer
- safety
- trial registration provenance

**Protocol takeaway:** Use registry data to verify trial identity/design only.

**Claim use:** `context-only`.

## Extraction details

- **Source kind:** trial_registry
- **Study design:** rct
- **Participants:** 25871 (registry_reported)
- **Population:** US men and women enrolled in the VITAL primary-prevention trial
- **Intervention/exposure:** vitamin D3 and marine omega-3 fatty acids in a randomized factorial trial
- **Comparator/control:** placebo in factorial design
- **Duration/follow-up:** registry intervention phase median about 5.3 years in linked VITAL publications
- **Endpoints:** cardiovascular disease, cancer, safety, trial registration provenance
- **Effect or direction:** Registry anchor only; VITAL outcome claims should cite the primary NEJM publication rather than registry metadata.
- **Adverse events/safety:** Registry source supports provenance for safety monitoring but does not supply extracted adverse-event results here.
- **Population mismatch:** Older primary-prevention adults; not all supplement users.
- **Directness:** `direct_protocol`
- **Artifact rights status:** `open_access`

## Limitations

- ClinicalTrials.gov record, not a results paper.
- Factorial vitamin D plus omega-3 design.
- Use for provenance only.
