---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:intermittent-pneumatic-compression
slug: families/intermittent-pneumatic-compression
title: Intermittent Pneumatic Compression
summary: Intermittent pneumatic compression modalities that cyclically inflate garments around the limbs, separated into consumer recovery/comfort protocols and clinician-supervised medical IPC uses.
status: field-testing
quality: usable
aliases:
- IPC
- intermittent pneumatic compression
- sequential pneumatic compression
- dynamic pneumatic compression
- pressotherapy
- compression boots
- pneumatic compression devices
categories:
- compression
- recovery
- circulation
- clinical-boundary
familyKind: modality
canonicalModality: intermittent_pneumatic_compression
relations:
- type: related_protocol
  target: protocol_variant:intermittent-pneumatic-compression/pneumatic-compression-pants
- type: cites
  target: source_artifact:doi-10.1519-ssc.0000000000000892
- type: cites
  target: source_artifact:pmid-35456170
- type: cites
  target: source_artifact:pmid-39416507
- type: cites
  target: source_artifact:pmid-40325678
- type: cites
  target: source_artifact:hyperice-normatec-contraindications-2021-09-07
- type: cites
  target: source_artifact:therabody-pneumatic-compression-precautions-2026-04-25
- type: cites
  target: source_artifact:nice-ng89-vte-risk-reduction-2018-03-21
- type: cites
  target: source_artifact:cms-pneumatic-compression-devices-2002-01-14
- type: cites
  target: source_artifact:pmid-39207406
- type: cites
  target: source_artifact:doi-10.1177-02683555221145779
- type: cites
  target: source_artifact:doi-10.3390-life15050725
- type: cites
  target: source_artifact:doi-10.1111-ddg.15415
- type: cites
  target: source_artifact:pmid-24974070
- type: cites
  target: source_artifact:pmid-31531971
- type: cites
  target: source_artifact:pmid-38743805
- type: cites
  target: source_artifact:pmid-34528370
- type: cites
  target: source_artifact:cdc-dvt-pe-travel-2025-04-23
lineage:
  relationship: root
  rationale: Parent family for lower-limb consumer recovery protocols and separate medically supervised IPC branches.
attribution:
  ownerType: murph
researchCoverage:
  protocolKey: protocol_variant:intermittent-pneumatic-compression/pneumatic-compression-pants
  sourceLedgerRecords: 271
  sourcePagesGenerated: 260
  auditDate: '2026-04-26'
  notes:
  - The family keeps consumer recovery/comfort evidence separate from VTE prophylaxis, lymphedema, venous ulcer, PAD/CLTI, wound, post-surgical, and hospital IPC evidence.
  - The first Murph canonical protocol under this family is Pneumatic Compression Pants.
---

Intermittent pneumatic compression is the family for devices that rhythmically inflate and deflate limb garments.

The family is intentionally split into two tracks. Consumer recovery or comfort protocols can test subjective soreness, perceived recovery, leg heaviness, and session tolerability. Clinical IPC branches cover VTE prophylaxis, stroke/hospital care, lymphedema, lipedema, post-thrombotic syndrome, venous ulcers, PAD/CLTI, wounds, diabetes-related foot risk, post-surgical immobilization, and other supervised indications.

The split matters because the evidence and safety posture differ. Sports-recovery reviews and trials are mixed and mostly support cautious soreness/comfort language, while clinical IPC sources involve screened patients, prescribed indications, longer exposure schedules, monitoring, and medical endpoints. Sources: `source_artifact:doi-10.1519-ssc.0000000000000892`, `source_artifact:pmid-35456170`, `source_artifact:pmid-39416507`, `source_artifact:nice-ng89-vte-risk-reduction-2018-03-21`, `source_artifact:cms-pneumatic-compression-devices-2002-01-14`, `source_artifact:pmid-39207406`, `source_artifact:doi-10.1177-02683555221145779`, `source_artifact:doi-10.3390-life15050725`, `source_artifact:doi-10.1111-ddg.15415`, `source_artifact:pmid-24974070`, `source_artifact:pmid-31531971`, `source_artifact:pmid-38743805`, `source_artifact:pmid-34528370`.

For Murph, this family should keep external named device protocols and manufacturer routines separate from the canonical Pneumatic Compression Pants protocol unless a source explicitly supports that exact external routine.
