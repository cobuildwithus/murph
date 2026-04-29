---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:awmf-intermittent-pneumatic-compression-2025-04-28
slug: sources/intermittent-pneumatic-compression/awmf-intermittent-pneumatic-compression-2025-04-28
title: "S1-Leitlinie Intermittierende pneumatische Kompressionstherapie (IPK)"
summary: "Safety, contraindications, adverse events, and device instructions source for the pneumatic compression pants research package. Role: safety-only; directness: safety_boundary. General IPC clinical guideline; useful for contraindication and supervised-use boundaries. Use for contraindications, stop rules, or adverse-event boundary; do not use as efficacy evidence. Do not commit copyrighted PDF; use metadata/link or manifest placeholder unless rights are cleared."
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
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: "https://register.awmf.org/de/leitlinien/detail/037-007"
  canonicalUrl: "https://register.awmf.org/de/leitlinien/detail/037-007"
source:
  kind: guideline
  title: "S1-Leitlinie Intermittierende pneumatische Kompressionstherapie (IPK)"
  url: "https://register.awmf.org/de/leitlinien/detail/037-007"
researchEvidence:
  designKind: guideline
  designLabel: "guideline"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Safety, contraindications, adverse events, and device instructions"
directness: "safety_boundary"
claimUse: "safety-only"
murphV1Priority: "high"
pdfRightsStatus: "permission_required"
---

This source is included for **Safety, contraindications, adverse events, and device instructions**.

**Findings:** The guideline lists absolute contraindications including decompensated heart failure, extensive thrombophlebitis/thrombosis or suspected thrombosis, acute erysipelas, acute phlegmon, compartment syndrome, severe uncontrolled hypertension, and lymph-drainage occlusion when IPC has caused congestion in the groin or genital area. Relative contraindications include extensive or open soft-tissue trauma, pronounced neuropathy, and blistering dermatoses. It recommends textile skin protection, regular skin inspection/care, padding at predisposed pressure sites, and specifying home-use duration, frequency, pressure setting, protective measures, and medical controls.

**Why it matters:** It is one of the most IPC-specific safety-boundary sources and includes home-use instruction elements directly relevant to pneumatic pants.

**Potential experiment signals:** Skin damage; nerve compression; pelvic/genital edema; thrombosis suspicion; infection; uncontrolled hypertension; prescribed dose and monitoring plan.

**Protocol takeaway:** Use absolute contraindications as hard stop rules; treat relative contraindications, lymphedema-related genital/pelvic edema, and neuropathy/skin instability as medical-supervision situations.

**Claim use:** `safety-only`.
