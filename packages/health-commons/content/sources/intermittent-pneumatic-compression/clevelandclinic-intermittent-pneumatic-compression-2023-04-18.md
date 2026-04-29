---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clevelandclinic-intermittent-pneumatic-compression-2023-04-18
slug: sources/intermittent-pneumatic-compression/clevelandclinic-intermittent-pneumatic-compression-2023-04-18
title: "Intermittent Pneumatic Compression Devices"
summary: "Safety, contraindications, adverse events, and device instructions source for the pneumatic compression pants research package. Role: safety-only; directness: same_mechanism. Use for contraindications, stop rules, or adverse-event boundary; do not use as efficacy evidence. Rights unclear; verify before adding downloadable artifacts."
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
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: "https://my.clevelandclinic.org/health/treatments/14791-intermittent-pneumatic-compression-ipc-device"
  canonicalUrl: "https://my.clevelandclinic.org/health/treatments/14791-intermittent-pneumatic-compression-ipc-device"
source:
  kind: web_page
  title: "Intermittent Pneumatic Compression Devices"
  url: "https://my.clevelandclinic.org/health/treatments/14791-intermittent-pneumatic-compression-ipc-device"
researchEvidence:
  designKind: other
  designLabel: "other"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Safety, contraindications, adverse events, and device instructions"
directness: "same_mechanism"
claimUse: "safety-only"
murphV1Priority: "medium"
pdfRightsStatus: "unknown"
---

This source is included for **Safety, contraindications, adverse events, and device instructions**.

**Findings:** The page lists possible complications such as warmth/sweat under sleeves, limited movement, discomfort, skin irritation or breakdown, and rare nerve damage or pressure injury. It advises reporting pain and calling a provider for swelling, warmth, pain, skin sores, or shortness of breath, and removing sleeves before walking to avoid tripping or falling.

**Why it matters:** It translates clinical IPC risk language into patient-facing stop signals.

**Potential experiment signals:** Pain; skin irritation/breakdown; swelling; warmth; sores; shortness of breath; fall risk.

**Protocol takeaway:** IPC should not hurt; remove garments before walking and seek care for swelling, warmth, pain, sores, or shortness of breath.

**Claim use:** `safety-only`.
