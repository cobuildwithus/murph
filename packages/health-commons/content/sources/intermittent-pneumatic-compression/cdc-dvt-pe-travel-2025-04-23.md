---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cdc-dvt-pe-travel-2025-04-23
slug: sources/intermittent-pneumatic-compression/cdc-dvt-pe-travel-2025-04-23
title: "Deep Vein Thrombosis and Pulmonary Embolism"
summary: "Travel comfort, flight edema, and VTE boundary source for the pneumatic compression pants research package. Role: safety-only; directness: safety_boundary. Use for contraindications, stop rules, or adverse-event boundary; do not use as efficacy evidence."
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
    url: "https://www.cdc.gov/yellow-book/hcp/travel-air-sea/deep-vein-thrombosis-and-pulmonary-embolism.html"
  canonicalUrl: "https://www.cdc.gov/yellow-book/hcp/travel-air-sea/deep-vein-thrombosis-and-pulmonary-embolism.html"
source:
  kind: web_page
  title: "Deep Vein Thrombosis and Pulmonary Embolism"
  url: "https://www.cdc.gov/yellow-book/hcp/travel-air-sea/deep-vein-thrombosis-and-pulmonary-embolism.html"
researchEvidence:
  designKind: guideline
  designLabel: "guideline"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Travel comfort, flight edema, and VTE boundary"
directness: "safety_boundary"
claimUse: "safety-only"
murphV1Priority: "high"
pdfRightsStatus: "open_access"
---

This source is included for **Travel comfort, flight edema, and VTE boundary**.

**Findings:** Population/count: Travelers and travel-medicine clinicians. Participant count: 0 (not_applicable). Intervention/exposure: Travel-risk screening, mobility guidance, and prophylaxis boundaries for DVT/PE. Comparator/control: Not applicable. Duration/follow-up: Long-distance travel, especially flights or travel segments longer than 4 to 6 hours. Endpoints: travel-associated DVT/PE risk factors, warning symptoms, prevention boundaries, compression stocking guidance. Effect/direction: Identifies travel-associated VTE risk as higher in travelers with major risk factors; recommends ambulation/calf exercises and individualized medical prophylaxis rather than broad consumer-device claims. Safety/adverse events: DVT symptoms include leg pain, tenderness, swelling, warmth, and redness; PE symptoms include unexplained shortness of breath, chest pain, cough/hemoptysis, or syncope. High-risk travelers may need clinician-directed prophylaxis. Limitations: Guideline context rather than a trial of pneumatic compression pants.; Does not evaluate consumer pneumatic pants for travel comfort or DVT prevention. Population mismatch: Medical travel guidance; no direct consumer pneumatic-pants intervention.

**Why it matters:** Travel-associated VTE is the most important safety boundary when users ask whether compression pants can prevent clots during flights.

**Potential experiment signals:** travel-associated DVT/PE risk factors, warning symptoms, prevention boundaries, compression stocking guidance.

**Protocol takeaway:** Do not position pneumatic compression pants as a substitute for medical VTE prevention; direct high-risk travelers to clinician guidance.

**Claim use:** `safety-only`.
