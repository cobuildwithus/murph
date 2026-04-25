---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1080/02739615.2021.1890078"
slug: "sources/evening-screen-curfew/doi-10.1080-02739615.2021.1890078"
title: Prospective associations between pre-sleep electronics use and same-night sleep in healthy school-aged children
summary: Use as an important null and population-mismatch source; do not overgeneralize screen restrictions to all healthy children.
status: draft
quality: usable
categories:
- evening-screen-curfew
- digital-sunset
- adolescent-family-device-context
- adolescent_family_device_context
relations:
-
  type: related_protocol
  target: "protocol_variant:evening-screen-curfew/digital-sunset"
-
  type: parent_family
  target: "experiment_family:evening-screen-curfew"
source:
  kind: journal_article
  title: Prospective associations between pre-sleep electronics use and same-night sleep in healthy school-aged children
  authors: So CJ; Gallagher MW; Palmer CA; Alfano CA
  year: 2021
  journal: Children's Health Care
  doi: "10.1080/02739615.2021.1890078"
  url: "https://doi.org/10.1080/02739615.2021.1890078"
  citation: "So CJ, Gallagher MW, Palmer CA, Alfano CA. Prospective associations between pre-sleep electronics use and same-night sleep in healthy school-aged children. Children's Health Care. 2021;50(3):293-310. doi:10.1080/02739615.2021.1890078."
researchEvidence:
  designKind: prospective_cohort
  designLabel: "Cohort/observational study"
  participantCount: 55
  participantCountKind: reported
  populationLabel: Healthy pre-pubertal children aged 7-11 years without medical, psychiatric, or sleep disorders.
  durationLabel: "Five weeknights with parent/child reports and actigraphy."
  cohortKey: doi-10.1080-02739615.2021.1890078
  aggregateRole: primary
  notes:
  - "Directness classification: adjacent_variant."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: adolescent-family-school. Year(s): 2021. Candidate rationale: Prospective same-night exposure design; younger/school-aged population requires boundary handling."
sourceContext:
  evidenceBucket: adolescent_family_device_context
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  batchId: batch-005
  ledgerStudyDesign: cohort
  canonicalIdBasis: doi
  artifactRightsStatusGuess: permission_required
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **Adolescent, family, school, and device-type observational context**.

## Quick read

- **Source key:** `source_artifact:doi-10.1080/02739615.2021.1890078`
- **Design:** Cohort/observational study.
- **People studied or addressed:** Healthy pre-pubertal children aged 7-11 years without medical, psychiatric, or sleep disorders.
- **Participant count:** 55 (reported_in_open_article/abstract).
- **Role for Digital Sunset:** adjacent_variant / context-only.

## Extracted facts

- **Intervention or exposure:** Pre-sleep electronics use captured by daily diary; total use and specific device type.
- **Comparator or control:** Nights with lower/no electronics use; same-night within-person context.
- **Duration or follow-up:** Five weeknights with parent/child reports and actigraphy.
- **Endpoints:** same-night actigraphy sleep parameters; sleep reports; device-use type.
- **Effect estimates or direction:** Open abstract states neither total electronics use nor specific type predicted same-night sleep parameters.
- **Adverse events or safety notes:** No adverse-event signal extracted.

## Limitations and population mismatch

- Healthy younger children, not adolescents or adults.
- Small sample.
- Five weeknights; may not capture high-risk or high-use groups.

## Protocol boundary

Use as an important null and population-mismatch source; do not overgeneralize screen restrictions to all healthy children.

## Artifact notes

- No artifact manifest entry requested for this batch; rights status guess: `permission_required`.
- Do not commit copyrighted PDFs unless rights are clearly open and redistributable.

<!-- /SOURCE_PAGE_DRAFT -->

<!-- SOURCE_PAGE_DRAFT path="packages/health-commons/content/sources/evening-screen-curfew/pmid-23645706.md" -->

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
