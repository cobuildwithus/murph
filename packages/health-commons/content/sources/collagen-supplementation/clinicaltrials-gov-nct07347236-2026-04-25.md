---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct07347236-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct07347236-2026-04-25
title: MyNOURISH Hydrolysed Collagen Supplementation in Malnutrition Status
summary: Not-yet-enrolling registry record testing 15 g/day hydrolysed tilapia collagen plus multidisciplinary care in older adults with fragility fractures; no results extracted, included as clinical nutrition boundary evidence.
status: draft
quality: usable
aliases:
- NCT07347236
- MyNOURISH hydrolysed collagen fragility fractures
- PROTÉGEN Plus trial
categories:
- collagen-supplementation
- clinical-supervised-wound-nutrition
- clinical_supervised
- context-only
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT07347236
    url: https://clinicaltrials.gov/study/NCT07347236
  canonicalUrl: https://clinicaltrials.gov/study/NCT07347236
  identityAliases:
  - NCT07347236
  - MyNOURISH hydrolysed collagen fragility fractures
  - PROTÉGEN Plus trial
  - MyNOURISH Hydrolysed Collagen Supplementation in Malnutrition Status
source:
  kind: web_page
  title: MyNOURISH Hydrolysed Collagen Supplementation in Malnutrition Status
  authors: Hospital Pengajar Universiti Putra Malaysia
  citation: 'ClinicalTrials.gov. MyNOURISH: Hydrolysed Collagen Supplementation in Older Adults With Fragility Fractures. NCT07347236. Accessed 2026-04-25. https://clinicaltrials.gov/study/NCT07347236.'
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT07347236
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized open-label active-comparator clinical trial registry record
  populationLabel: Adults aged 60+ with a fragility fracture within the past 12 months receiving outpatient multidisciplinary care in Malaysia.
  durationLabel: 12-week intervention with follow-up to 24 weeks
  cohortKey: older-adults-fragility-fractures
  participantCount: 76
  participantCountKind: approximate
  aggregateRole: primary
evidenceBucket: clinical-supervised-wound-nutrition
whyItMatters: Preserves a malnutrition/fragility-fracture clinical nutrition variant without mixing it into wellness skin/joint/tendon claims.
potentialMurphEndpoints:
- malnutrition status
- albumin
- skeletal muscle mass
- fat-free mass
- functional capacity
- P1NP
- CTX
- adherence
- side effects
protocolTakeaway: 'Context-only/unpublished: do not cite for outcomes; use for research-watch and medical-care boundary notes.'
murphTakeaway: Fragility fractures, malnutrition risk, kidney disease, fish allergy, and unstable medical conditions require clinical decision-making rather than self-run supplement experimentation.
studyDesign: registered randomized controlled trial
modality: 15 g/day hydrolysed tilapia collagen (PROTÉGEN Plus) plus standard multidisciplinary care
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: clinical-supervised-wound-nutrition
  directness: clinical_supervised
  claimUse: context-only
  priority: low
  batchId: batch-011
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **clinical-supervised-wound-nutrition**.

**Findings:**

- The registry describes an open-label randomized trial with 76 estimated participants aged 60+ with recent fragility fractures. `[source_artifact:clinicaltrials-gov-nct07347236-2026-04-25]`
- The intervention arm receives 15 g/day hydrolysed tilapia collagen (PROTÉGEN Plus) with standard multidisciplinary care for 12 weeks; the comparator receives standard multidisciplinary care without collagen supplementation. `[source_artifact:clinicaltrials-gov-nct07347236-2026-04-25]`
- Planned endpoints include malnutrition status, albumin, body composition, functional capacity, bone turnover markers, adherence, and side effects through 24-week follow-up. No efficacy results were available in the extracted record. `[source_artifact:clinicaltrials-gov-nct07347236-2026-04-25]`

**Why it matters:** Preserves a malnutrition/fragility-fracture clinical nutrition variant without mixing it into wellness skin/joint/tendon claims. `[source_artifact:clinicaltrials-gov-nct07347236-2026-04-25]`

**Potential experiment signals:**

  - "malnutrition status"
  - "albumin"
  - "skeletal muscle mass"
  - "fat-free mass"
  - "functional capacity"
  - "P1NP"
  - "CTX"
  - "adherence"
  - "side effects"

**Protocol takeaway:** Context-only/unpublished: do not cite for outcomes; use for research-watch and medical-care boundary notes. `[source_artifact:clinicaltrials-gov-nct07347236-2026-04-25]`

**Population mismatch:** Adults aged 60+ with a fragility fracture within the past 12 months receiving outpatient multidisciplinary care in Malaysia.

**Limitations:**

- Registry record only; no results extracted.
- Not-yet-enrolling status in the accessed registry mirror.
- Open-label design planned.
- Clinical fragility-fracture and malnutrition context is outside self-run HCP wellness protocol evidence.

**Claim use:** `context-only`.
