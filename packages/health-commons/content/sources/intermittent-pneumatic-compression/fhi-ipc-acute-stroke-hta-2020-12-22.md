---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fhi-ipc-acute-stroke-hta-2020-12-22
slug: sources/intermittent-pneumatic-compression/fhi-ipc-acute-stroke-hta-2020-12-22
title: "Intermittent pneumatic compression for preventing deep vein thrombosis in acute stroke"
summary: "Clinical DVT prophylaxis and hospital boundary source for the pneumatic compression pants research package. Role: context-only; directness: safety_boundary. Clinical/supervised boundary evidence; do not generalize to unsupervised consumer recovery pants."
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
  identityKind: scholarly_work
  canonicalIdBasis: url
  identifiers:
    url: "https://www.fhi.no/en/publ/2020/Intermittent-pneumatic-compression-for-preventing-deep-vein-thrombosis-in-acute-stroke/"
  canonicalUrl: "https://www.fhi.no/en/publ/2020/Intermittent-pneumatic-compression-for-preventing-deep-vein-thrombosis-in-acute-stroke/"
source:
  kind: review
  title: "Intermittent pneumatic compression for preventing deep vein thrombosis in acute stroke"
  url: "https://www.fhi.no/en/publ/2020/Intermittent-pneumatic-compression-for-preventing-deep-vein-thrombosis-in-acute-stroke/"
researchEvidence:
  designKind: systematic_review
  designLabel: "systematic review"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: synthesis
evidenceBucket: "Clinical DVT prophylaxis and hospital boundary"
directness: "safety_boundary"
claimUse: "context-only"
murphV1Priority: "high"
pdfRightsStatus: "open_access"
---

This source is included for **Clinical DVT prophylaxis and hospital boundary**.

**Findings:** For IPC versus no IPC, DVT after 30 days in two studies occurred in 239/1451 IPC patients vs 310/1451 no-IPC patients (RR 0.77, 95% CI 0.66 to 0.90); proximal thrombosis in CLOTS 3 occurred in 122/1438 vs 174/1438 (RR 0.70, 95% CI 0.56 to 0.87). PE results were uncertain (20/1438 vs 35/1438; RR 0.83, 95% CI 0.51 to 1.35). Safety/adverse-event notes: FHI reports that IPC may lead to more frequent skin breaks but makes little or no difference in falls with injury or fractures. Limitations: Evidence base was largely CLOTS 3 plus two small older RCTs; mortality and PE evidence was lower certainty and confidence intervals crossed no-effect for mortality.

**Why it matters:** It defines the supervised clinical boundary for IPC use and helps prevent over-claiming consumer benefits.

**Potential experiment signals:** Skin breaks; Falls with injury/fracture; Quality of life/disability only in clinical research; DVT/PE only as clinician-managed endpoints.

**Protocol takeaway:** The strongest stroke evidence supports supervised IPC in immobile acute stroke, while safety monitoring and population mismatch prevent consumer generalization.

**Claim use:** `context-only`.
