---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:uroweb-male-infertility-guideline-2026-04-27
slug: sources/dry-sauna/uroweb-male-infertility-guideline-2026-04-27
title: Male Infertility
summary: The EAU Male Infertility guideline provides current clinical context for semen analysis and infertility assessment, but it is not evidence that sauna or groin cooling changes fertility outcomes.
status: draft
quality: usable
aliases:
- Male Infertility
categories:
- dry-sauna
- fertility-safety
- semen-analysis
relations:
- type: related_protocol
  target: protocol_variant:dry-sauna/bryan-johnson-blueprint
- type: parent_family
  target: experiment_family:dry-sauna
source:
  kind: guideline
  title: Male Infertility
  authors: European Association of Urology
  year: 2026
  journal: EAU Guidelines on Sexual and Reproductive Health
  url: https://uroweb.org/guidelines/sexual-and-reproductive-health/chapter/male-infertility
  citation: European Association of Urology. Male Infertility. EAU Guidelines on Sexual and Reproductive Health. 2026. https://uroweb.org/guidelines/sexual-and-reproductive-health/chapter/male-infertility
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: https://uroweb.org/guidelines/sexual-and-reproductive-health/chapter/male-infertility
  canonicalUrl: https://uroweb.org/guidelines/sexual-and-reproductive-health/chapter/male-infertility
researchEvidence:
  designKind: guideline
  designLabel: guideline
  populationLabel: Adult males seeking sexual and reproductive health or infertility evaluation
  durationLabel: Not extracted
  aggregateRole: synthesis
  cohortKey: dry-sauna-fertility-semen-cooling-context
  notes:
  - Participant count was not extracted from available metadata for this batch.
  - 'Limitations: Guideline source only; not a trial or observational sauna study.'
  - 'Population/protocol mismatch: General guideline/measurement context.'
evidenceBucket: Fertility, semen, and groin-cooling safety/context
whyItMatters: Provides professional context for interpreting fertility concerns around sauna use.
potentialMurphEndpoints:
- fertility-safety
- semen-analysis
protocolTakeaway: Use as a clinical safety and referral boundary.
murphTakeaway: Users with abnormal semen analyses or fertility concerns should not rely on protocol pages alone.
studyDesign: guideline
modality: male infertility guideline
claimUse: safety-only
directnessToBryanJohnsonSauna: general_guideline
claimUseBoundary: Use as a clinical safety and referral boundary.
sourceFindings:
- findingId: finding:uroweb-male-infertility-guideline-2026-04-27-batch007-fertility-safety
  sourceKey: source_artifact:uroweb-male-infertility-guideline-2026-04-27
  extractedFromArtifactId: art-uroweb-male-infertility-guideline-2026-04-27-html
  findingKind: measurement_validation
  population: Adult males seeking sexual and reproductive health or infertility evaluation
  exposure: EAU guideline chapter on male infertility
  outcome: Clinical evaluation, semen analysis, and infertility management context
  summary: The EAU Male Infertility guideline provides current clinical context for semen analysis and infertility assessment, but it is not evidence that sauna or groin cooling changes fertility outcomes.
  evidenceUse:
  - measurement
  - safety
murphV1Priority: Medium
pdfRightsStatus: permission_required
---

This source is included for **Fertility, semen, and groin-cooling safety/context**.

**Findings:** The EAU Male Infertility guideline provides current clinical context for semen analysis and infertility assessment, but it is not evidence that sauna or groin cooling changes fertility outcomes.

**Why it matters:** Provides professional context for interpreting fertility concerns around sauna use.

**Potential experiment signals:** fertility-safety, semen-analysis.

**Protocol takeaway:** Use as a clinical safety and referral boundary.

**Claim use:** `safety-only`.

**Directness and limitations:** General guideline/measurement context. Guideline source only; not a trial or observational sauna study.
