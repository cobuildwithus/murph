---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cms-pneumatic-compression-devices-2002-01-14
slug: sources/intermittent-pneumatic-compression/cms-pneumatic-compression-devices-2002-01-14
title: "National Coverage Determination (NCD) for Pneumatic Compression Devices (280.6)"
summary: "Clinical edema, lymphedema, venous, PAD, and wound-care boundary source for the pneumatic compression pants research package. Role: context-only; directness: clinical_supervised. Clinical/supervised boundary evidence; do not generalize to unsupervised consumer recovery pants. Rights unclear; verify before adding downloadable artifacts."
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
    url: "https://www.cms.gov/medicare-coverage-database/view/ncd.aspx?ncdid=225"
  canonicalUrl: "https://www.cms.gov/medicare-coverage-database/view/ncd.aspx?ncdid=225"
source:
  kind: web_page
  title: "National Coverage Determination (NCD) for Pneumatic Compression Devices (280.6)"
  url: "https://www.cms.gov/medicare-coverage-database/view/ncd.aspx?ncdid=225"
researchEvidence:
  designKind: other
  designLabel: "other"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Clinical edema, lymphedema, venous, PAD, and wound-care boundary"
directness: "clinical_supervised"
claimUse: "context-only"
murphV1Priority: "medium"
pdfRightsStatus: "unknown"
---

This source is included for **Clinical edema, lymphedema, venous, PAD, and wound-care boundary**.

**Findings:** The NCD covers PCDs for lymphedema or CVI with venous stasis ulcers; it requires documented conservative therapy failures/symptoms, physician prescription, pressure/frequency/duration treatment plan, instruction, and monitoring.

**Why it matters:** Defines medical/supervised boundaries that should not be conflated with consumer recovery protocols.

**Potential experiment signals:** Contraindication checklist, Physician oversight requirement, Pressure/frequency/duration documentation.

**Protocol takeaway:** Use as a safety/claims boundary, not efficacy evidence.

**Claim use:** `context-only`. This is not direct unsupervised consumer-recovery evidence.

**Safety and boundary notes:** Coverage language requires physician evaluation, medical-necessity documentation, instruction in operation, a defined treatment plan, and ongoing monitoring of use and response.

**Limitations:** Coverage policy, not a clinical efficacy study.; U.S. Medicare population and reimbursement scope only.; Does not address consumer recovery/wellness use..
