---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:clinicaltrials-nct02365025-2026-04-24"
slug: "sources/evening-screen-curfew/clinicaltrials-nct02365025-2026-04-24"
title: The Effects of a Parental Intervention on Electronic Media Exposure and Sleep Patterns in Adolescents
summary: "ClinicalTrials.gov counterpart for the parent-mediated adolescent media/sleep intervention; retain as methods/context and design cross-check, not an outcome source."
status: draft
quality: usable
categories:
- evening-screen-curfew
- digital-sunset
- adjacent-behavioral-interventions
- adjacent_behavioral_interventions
relations:
-
  type: related_protocol
  target: "protocol_variant:evening-screen-curfew/digital-sunset"
-
  type: parent_family
  target: "experiment_family:evening-screen-curfew"
source:
  kind: web_page
  title: The Effects of a Parental Intervention on Electronic Media Exposure and Sleep Patterns in Adolescents
  authors: ClinicalTrials.gov registry record
  journal: ClinicalTrials.gov
  url: "https://clinicaltrials.gov/study/NCT02365025"
  citation: "ClinicalTrials.gov. NCT02365025: The Effects of a Parental Intervention on Electronic Media Exposure and Sleep Patterns in Adolescents."
researchEvidence:
  designKind: controlled_trial
  designLabel: Controlled-trial registry record; publication counterpart reports nonrandomized comparative design
  populationLabel: Adolescents and parents; full registry population fields were not fully accessible in this extraction.
  durationLabel: Not fully extracted from registry page; linked publication followed participants to 3 months.
  cohortKey: clinicaltrials-nct02365025-2026-04-24
  aggregateRole: primary
  notes:
  - "Directness classification: adjacent_variant."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: direct-intervention. Year(s): year not listed. Candidate registry link to publication source_artifact:pmid-35323167; retain separately until verified in extraction. Candidate rationale: Registry counterpart for the parent-intervention evidence; useful for methods and outcomes cross-checking."
sourceContext:
  evidenceBucket: adjacent_behavioral_interventions
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  batchId: batch-002
  ledgerStudyDesign: controlled_trial
  canonicalIdBasis: url
  artifactRightsStatusGuess: unknown
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **adjacent_behavioral_interventions** in the Digital Sunset research workspace.

## Extraction status
Draft extraction for `batch-002` / adjacent behavioral intervention variants. Directness is `adjacent_variant` and claim use is `context-only`. This page is not a protocol synthesis.

## Methods snapshot
- **Design:** Controlled-trial registry record; publication counterpart reports nonrandomized comparative design.
- **Participants:** not extracted from accessible registry text; linked publication reported 70 dyads; Adolescents and parents; full registry population fields were not fully accessible in this extraction.
- **Intervention/exposure:** Parental intervention intended to reduce adolescent electronic media exposure and improve sleep patterns.
- **Comparator/control:** Registry control/comparator details not fully extracted; linked publication used written information.
- **Duration/follow-up:** Not fully extracted from registry page; linked publication followed participants to 3 months.
- **Endpoints extracted:** electronic media exposure, sleep patterns.

## Results extracted
- Registry source supplies hypothesis/context and possible publication linkage; no efficacy result is extracted from the registry itself.
- Use the journal publication source separately for outcome claims.

## Digital Sunset relevance
This source is `adjacent_variant` for **Digital Sunset No Personal Screens Before Bed**. It should be used as `context-only` evidence only. Adjacent or mechanism findings must not be promoted into direct protocol efficacy claims.

## Safety/adverse events
- **Adverse events:** Not extracted.
- **Safety notes:** No safety result extracted from registry record.

## Limitations and population mismatch
- Official registry page content was only partially accessible; extraction relies on accessible registry snippets/mirrors and linked publication context.
- Registry and publication design classifications may differ.
- Do not use this registry as an outcome source.

## Artifact and rights notes
Rights status guess: `unknown`. Registry metadata only. No PDF or archived artifact candidate.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
