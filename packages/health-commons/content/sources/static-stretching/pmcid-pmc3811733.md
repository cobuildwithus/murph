---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:pmcid-PMC3811733
slug: sources/static-stretching/pmcid-pmc3811733
title: Concurrent Validity of Digital Inclinometer and Universal Goniometer in Assessing Passive Hip Mobility in Healthy Subjects
summary: This source supports the existence of clinical validation work comparing inclinometer and goniometer hip ROM measures, but quantitative claims need full extraction.
status: draft
quality: usable
aliases:
- Concurrent Validity of Digital Inclinometer and Universal Goniometer in Assessing Passive Hip Mobility in Healthy Subjects
- PMCID PMC3811733
- source_artifact:pmcid-pmc3811733
categories:
- static-stretching
relations:
-
  type: related_protocol
  target: protocol_variant:static-stretching/at-home-static-stretching-for-flexibility
-
  type: parent_family
  target: experiment_family:static-stretching
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: pmcid
  identifiers:
    pmcid: PMC3811733
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC3811733/
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC3811733/
  identityAliases:
  - Concurrent Validity of Digital Inclinometer and Universal Goniometer in Assessing Passive Hip Mobility in Healthy Subjects
sourceIdentifiers:
  pmcid: PMC3811733
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC3811733/
source:
  kind: journal_article
  title: Concurrent Validity of Digital Inclinometer and Universal Goniometer in Assessing Passive Hip Mobility in Healthy Subjects
  authors: Roach S; San Juan JG; Suprak DN; Lyda M
  year: 2013
  journal: International Journal of Sports Physical Therapy
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC3811733/
  citation: Roach S; San Juan JG; Suprak DN; Lyda M. (2013). Concurrent Validity of Digital Inclinometer and Universal Goniometer in Assessing Passive Hip Mobility in Healthy Subjects. International Journal of Sports Physical Therapy. PMCID:PMC3811733.
researchEvidence:
  designKind: cross_sectional
  designLabel: Concurrent validity study of digital inclinometer and universal goniometer for passive hip mobility
  populationLabel: Healthy subjects
  durationLabel: Single-session concurrent validity measurement design
  aggregateRole: primary
  cohortKey: batch-012-region-specific-remote-measurement
  notes:
  - 'Intervention/exposure: Passive hip mobility measured with a digital inclinometer'
  - 'Comparator/control: Universal goniometer measurements'
  - 'Effect/direction: The study assessed concurrent validity of digital inclinometer and universal goniometer measures for passive hip mobility; exact coefficients were not extracted from accessible batch materials.'
  - 'Adverse events/safety: No adverse events were extracted.'
  - 'Population mismatch: Healthy subjects, not home stretchers or people with hip limitations.'
evidenceBucket: region_specific_remote_measurement
whyItMatters: Hip mobility is a plausible endpoint in static-stretching experiments; instrument agreement affects signal quality.
potentialMurphEndpoints:
- Passive hip extension
- Hip internal rotation
- Hip external rotation
- Digital inclinometer validity
- Universal goniometer comparison
protocolTakeaway: Use only as measurement context unless exact coefficients are extracted.
murphTakeaway: Hip ROM tools are not automatically interchangeable; method consistency matters.
studyDesign: measurement_validation
modality: Digital inclinometer versus universal goniometer hip mobility measurement
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
canonicalizationNote: PMCID identifier is PMC3811733; source key preserves PMCID casing per canonical ledger while the file path remains lowercase.
---

This source is included for **region_specific_remote_measurement**.

**Findings:** The study assessed concurrent validity of digital inclinometer and universal goniometer measures for passive hip mobility; exact coefficients were not extracted from accessible batch materials.

**Why it matters:** Hip mobility is a plausible endpoint in static-stretching experiments; instrument agreement affects signal quality.

**Potential experiment signals:** Passive hip extension, Hip internal rotation, Hip external rotation, Digital inclinometer validity, Universal goniometer comparison.

**Protocol takeaway:** Use only as measurement context unless exact coefficients are extracted.

**Claim use:** `context-only`.

**Extraction boundaries:**

- Population: Healthy subjects
- Intervention/exposure: Passive hip mobility measured with a digital inclinometer
- Comparator/control: Universal goniometer measurements
- Duration/follow-up: Single-session concurrent validity measurement design
- Adverse events or safety notes: No adverse events were extracted.
- Population mismatch: Healthy subjects, not home stretchers or people with hip limitations.
- Directness: Measurement context for hip mobility endpoints.

**Limitations:**

- Healthy subjects only.
- Exact sample size and validity coefficients were not extracted.
- Measurement source only.
