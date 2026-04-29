---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06549738-2026-04-25
slug: sources/intermittent-pneumatic-compression/clinicaltrials-gov-nct06549738-2026-04-25
title: "Effects of Intermittent Pneumatic Compression Therapy on Tissue Volume, Pain, and Quality of Life in Women Living With Lipedema"
summary: "Current, pending, registry, and preprint context source for the pneumatic compression pants research package. Role: context-only; directness: clinical_supervised. Current/pending context only; do not count as completed efficacy evidence. Rights unclear; verify before adding downloadable artifacts."
status: draft
quality: usable
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
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    url: "https://clinicaltrials.gov/study/NCT06549738"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT06549738"
source:
  kind: other
  title: "Effects of Intermittent Pneumatic Compression Therapy on Tissue Volume, Pain, and Quality of Life in Women Living With Lipedema"
  url: "https://clinicaltrials.gov/study/NCT06549738"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "rct"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Current, pending, registry, and preprint context"
directness: "clinical_supervised"
claimUse: "context-only"
murphV1Priority: "medium"
pdfRightsStatus: "unknown"
---

This source is included for **Current, pending, registry, and preprint context**.

**Findings:** Completed; hasResults false. The registry describes Lympha Press Optimal Plus IPCD with Lympha Pants garment treating abdomen, pelvis, buttocks, trunk, legs, and feet; daily compression leggings also provided compared with Compression leggings only during waking hours. Planned endpoints include ultrasound adipose-tissue/fascia assessment, tissue volume by tape, 3D scanner, and caliper, bioimpedance fluid volume, VAS pain, SF-36 quality of life, LEFS, skin biopsy microvasculature, thermography, Timed Up and Go, GAITRite gait measures, chart review for veins/venous disease. No effect estimates posted; ClinicalTrials.gov hasResults is false.

**Why it matters:** This is the most pants-like registry record in the batch because it explicitly uses Lympha Pants, but it is clinical lipedema context and cannot be promoted to healthy recovery claims.

**Potential experiment signals:** leg/trunk volume, fluid volume, pain VAS, quality of life, LEFS, TUG/gait, home-use tolerance.

**Protocol takeaway:** Use as clinical-supervised and population-mismatch context for pants-type IPC devices; do not use as direct efficacy evidence for healthy users.

**Claim use:** `context-only`. Registry record only; no posted ClinicalTrials.gov results. Disease-specific lipedema sample and medical-device context limit generalization to healthy users. Control group also used compression leggings, so any future result would compare IPCD-plus-leggings against leggings rather than no compression. Home adherence and pressure tolerance may vary. Population mismatch: Clinical lipedema population using an FDA-cleared medical compression system; not a healthy sports-recovery, travel, or routine consumer-wellness sample. Artifact rights status: unknown; use external registry links or manifest metadata only unless redistributable rights are confirmed.
