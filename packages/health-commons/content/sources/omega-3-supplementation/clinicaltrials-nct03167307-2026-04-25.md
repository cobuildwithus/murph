---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03167307-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct03167307-2026-04-25
title: The Omega-3 Fatty Acid Paediatric Depression Trial
summary: Registry-only pediatric depression omega-3 trial record.
status: draft
quality: usable
aliases:
- The Omega-3 Fatty Acid Paediatric Depression Trial
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
  title: The Omega-3 Fatty Acid Paediatric Depression Trial
  authors: ClinicalTrials.gov registry record; Omega-3pMDD investigators
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. The Omega-3 Fatty Acid Paediatric Depression Trial. NCT03167307. Accessed 2026-04-25.
  url: https://clinicaltrials.gov/study/NCT03167307
researchEvidence:
  designKind: other
  designLabel: Trial registry / protocol record
  participantCount: 220
  participantCountKind: approximate
  populationLabel: Children and adolescents with pediatric major depressive disorder.
  durationLabel: 36-week treatment phase in published protocol context.
  aggregateRole: context
  cohortKey: clinicaltrials-nct03167307-2026-04-25
evidenceBucket: mood_cognition
whyItMatters: Trial-registry boundary for pediatric depression evidence.
potentialMurphEndpoints:
- Children's Depression Rating Scale-Revised total score
- recovery rates
- remission
- quality of life
- safety
protocolTakeaway: Use only as registry context; efficacy belongs to the published RCT source.
murphTakeaway: Use only as registry context; efficacy belongs to the published RCT source.
studyDesign: other
modality: oral EPA/DHA supplementation
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: unknown
---
This source is included for **mood_cognition**.

**Findings:** Registry context only; linked published trial evidence is separately captured under PMID 41481294. Safety note: Registry captures pediatric clinical trial context; no observed adverse-event extraction from registry.

**Why it matters:** Trial-registry boundary for pediatric depression evidence.

**Potential experiment signals:** Children's Depression Rating Scale-Revised total score, recovery rates, remission, quality of life, safety.

**Protocol takeaway:** Use only as registry context; efficacy belongs to the published RCT source.

**Population mismatch:** Pediatric depression; not adult protocol evidence.

**Limitations:** Registry record is not outcome evidence by itself.; Pediatric MDD is a clinical-supervised population mismatch.

**Claim use:** `context-only`.
