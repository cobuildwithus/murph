---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-ng89-vte-risk-reduction-2018-03-21
slug: sources/intermittent-pneumatic-compression/nice-ng89-vte-risk-reduction-2018-03-21
title: "Venous thromboembolism in over 16s: reducing the risk of hospital-acquired deep vein thrombosis or pulmonary embolism"
summary: "Clinical DVT prophylaxis and hospital boundary source for the pneumatic compression pants research package. Role: safety-only; directness: safety_boundary. Duplicate NICE NG89 guideline rows normalized to one dated web key. Deduped from 2 candidate rows across clinical-dvt-hospital-boundary, safety-contraindications-adverse-events. Use for contraindications, stop rules, or adverse-event boundary; do not use as efficacy evidence. Do not commit copyrighted PDF; use metadata/link or manifest placeholder unless rights are cleared."
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
    url: "https://www.nice.org.uk/guidance/ng89"
  canonicalUrl: "https://www.nice.org.uk/guidance/ng89"
source:
  kind: guideline
  title: "Venous thromboembolism in over 16s: reducing the risk of hospital-acquired deep vein thrombosis or pulmonary embolism"
  url: "https://www.nice.org.uk/guidance/ng89"
researchEvidence:
  designKind: guideline
  designLabel: "guideline"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Clinical DVT prophylaxis and hospital boundary"
directness: "safety_boundary"
claimUse: "safety-only"
murphV1Priority: "high"
pdfRightsStatus: "permission_required"
---

This source is included for **Clinical DVT prophylaxis and hospital boundary**.

**Findings:** Guideline requires VTE and bleeding risk assessment, balancing individual risks; for some procedures it considers IPC only when pharmacological prophylaxis is contraindicated or as one mechanical option until mobility improves. Safety/adverse-event notes: Emphasizes bleeding risk assessment, correct use, side effects, discharge warnings for DVT/PE symptoms, and seeking medical help for suspected adverse events. Limitations: Guideline is safety and care-pathway evidence, not direct efficacy evidence for consumer pants or self-treatment.

**Why it matters:** It defines the supervised clinical boundary for IPC use and helps prevent over-claiming consumer benefits.

**Potential experiment signals:** Bleeding-risk screening boundary; DVT/PE symptom education boundary; Mobility-based stop rules; Clinician risk reassessment.

**Protocol takeaway:** Any user with suspected clot risk, recent surgery, immobility, pregnancy/postpartum status, cancer, trauma, or bleeding-risk questions should seek clinician guidance rather than relying on pants.

**Claim use:** `safety-only`.
