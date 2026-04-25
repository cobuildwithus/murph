---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1111/jcc4.12109"
slug: "sources/evening-screen-curfew/doi-10.1111-jcc4.12109"
title: "The Extended iSelf: The Impact of iPhone Separation on Cognition, Emotion, and Physiology"
summary: Acute iPhone-separation experiment found increased anxiety and physiological arousal when participants could not answer their ringing phone; use as a burden and tolerance boundary for abrupt phone removal.
status: draft
quality: usable
categories:
- evening-screen-curfew
- digital-sunset
- safety-burden-life-fit
- safety_burden_life_fit
relations:
-
  type: related_protocol
  target: "protocol_variant:evening-screen-curfew/digital-sunset"
-
  type: parent_family
  target: "experiment_family:evening-screen-curfew"
source:
  kind: journal_article
  title: "The Extended iSelf: The Impact of iPhone Separation on Cognition, Emotion, and Physiology"
  authors: Clayton RB, Leshner G, Almond A
  year: 2015
  journal: Journal of Computer-Mediated Communication
  doi: "10.1111/jcc4.12109"
  url: "https://doi.org/10.1111/jcc4.12109"
  citation: "Clayton RB, Leshner G, Almond A. The Extended iSelf: The Impact of iPhone Separation on Cognition, Emotion, and Physiology. Journal of Computer-Mediated Communication. 2015;20(2):119-135. doi:10.1111/jcc4.12109."
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Acute Within-subjects Experiment
  populationLabel: Adult iPhone users in an acute laboratory task.
  durationLabel: Acute task session.
  aggregateRole: primary
  notes:
  - "Directness classification: adjacent_variant."
  - "Protocol claim-use classification: safety-only."
  - "Discovery shards: safety-burden-life-fit. Year(s): 2015. Candidate rationale: Mechanistic phone-separation study; may explain anxiety or rumination during phone removal."
sourceContext:
  evidenceBucket: safety_burden_life_fit
  directness: adjacent_variant
  claimUse: safety-only
  priority: medium
  batchId: batch-008
  ledgerStudyDesign: acute_physiology
  canonicalIdBasis: doi
  artifactRightsStatusGuess: open_access
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **safety, burden, withdrawal, and clinical-boundary evidence** in the Digital Sunset extraction batch.

## Quick read

- **Source type:** Acute Within-subjects Experiment (2015).
- **People studied or addressed:** Adult iPhone users in an acute laboratory task.
- **Exposure/intervention:** Temporary iPhone separation while the participant's phone rang during a cognitive task.
- **Comparator/control:** Phone access or non-separated task condition within the same experiment.
- **Role for Digital Sunset:** adjacent_variant; safety-only. This source is not upgraded to direct Digital Sunset efficacy unless the source itself directly tested no personal screens before bed.

## Extracted source-local finding

In 40 iPhone users, inability to answer a ringing phone during a word-search task was associated with increased anxiety/unpleasantness, increased heart rate and blood pressure, and worse cognitive performance. This is adjacent mechanism evidence for possible burden during phone separation.

## Endpoints extracted

anxiety, unpleasantness, heart rate, blood pressure, cognitive performance

## Duration or follow-up

Acute task session.

## Safety, adverse events, and clinical boundaries

Mechanistic burden source. It does not establish harm from Digital Sunset but supports watching for anxiety, rumination, or distress during abrupt phone separation.

## Important limits and population mismatch

- Acute laboratory iPhone-separation task, not a bedtime screen-curfew intervention.
- Small sample of iPhone users.
- The ringing-phone condition may be more stressful than a planned bedtime screen boundary.

## Artifact and rights notes

- **Rights status guess:** open_access
- **Artifact handling:** metadata/manifest candidate only unless a directly redistributable open-license artifact is verified. Copyrighted PDFs should not be committed to Git.

## Source key

`source_artifact:doi-10.1111/jcc4.12109`

---

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
