---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:hyperice-normatec-contraindications-2021-09-07
slug: sources/intermittent-pneumatic-compression/hyperice-normatec-contraindications-2021-09-07
title: "Are there any contraindications for the Normatec?"
summary: "Safety, contraindications, adverse events, and device instructions source for the pneumatic compression pants research package. Role: safety-only; directness: direct_protocol. Deduped from 2 candidate rows across consumer-device-aliases, safety-contraindications-adverse-events. Use for contraindications, stop rules, or adverse-event boundary; do not use as efficacy evidence. Rights unclear; verify before adding downloadable artifacts."
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
    url: "https://hyperice.zendesk.com/hc/en-us/articles/360046872273-Are-there-any-contraindications-for-the-Normatec"
  canonicalUrl: "https://hyperice.zendesk.com/hc/en-us/articles/360046872273-Are-there-any-contraindications-for-the-Normatec"
source:
  kind: web_page
  title: "Are there any contraindications for the Normatec?"
  url: "https://hyperice.zendesk.com/hc/en-us/articles/360046872273-Are-there-any-contraindications-for-the-Normatec"
researchEvidence:
  designKind: other
  designLabel: "other"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Safety, contraindications, adverse events, and device instructions"
directness: "direct_protocol"
claimUse: "safety-only"
murphV1Priority: "backbone"
pdfRightsStatus: "unknown"
---

This source is included for **Safety, contraindications, adverse events, and device instructions**.

**Findings:** Hyperice states not to use Normatec in the presence of acute pulmonary edema, acute thrombophlebitis, acute congestive cardiac failure, acute infections, deep vein thrombosis, pulmonary embolism episodes, wounds or lesions near the site, tumors, fractures or dislocations, or situations where increased venous or lymphatic return is undesirable.

**Why it matters:** This is direct device-family safety language for Normatec use and should anchor stop/screening rules rather than recovery claims.

**Potential experiment signals:** Contraindication yes/no screen; new clot symptoms; local wounds or infection; acute cardiopulmonary symptoms; fracture or dislocation near the garment site.

**Protocol takeaway:** Do not use pneumatic compression pants when a listed contraindication is present; route to medical evaluation instead.

**Claim use:** `safety-only`.
