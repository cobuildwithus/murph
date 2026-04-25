---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.55489/njcm.151020244192"
slug: "sources/evening-screen-curfew/doi-10.55489-njcm.151020244192"
title: "Restriction of Mobile Phone Usage at Bed Time: Effect on Sleep Quality, Mood and Cognitive Function"
summary: "One-group pre/post Indian undergraduate study using an app-enforced bedtime phone restriction; useful as direct but uncontrolled context evidence."
status: draft
quality: usable
categories:
- evening-screen-curfew
- digital-sunset
- direct_protocol_trials_and_registries
relations:
-
  type: related_protocol
  target: "protocol_variant:evening-screen-curfew/digital-sunset"
-
  type: parent_family
  target: "experiment_family:evening-screen-curfew"
source:
  kind: journal_article
  title: "Restriction of Mobile Phone Usage at Bed Time: Effect on Sleep Quality, Mood and Cognitive Function"
  authors: Sivagurunathan P, Vaithilingan S, Vinothkumar R
  year: 2024
  journal: National Journal of Community Medicine
  doi: "10.55489/njcm.151020244192"
  url: "https://www.njcmindia.com/index.php/file/article/view/4192"
  citation: "Sivagurunathan P, Vaithilingan S, Vinothkumar R. Restriction of Mobile Phone Usage at Bed Time: Effect on Sleep Quality, Mood and Cognitive Function. National Journal of Community Medicine. 2024;15(10):785-791. doi:10.55489/njcm.151020244192."
researchEvidence:
  designKind: pilot_intervention
  designLabel: "Quasi-experimental one-group pre/post intervention"
  participantCount: 68
  participantCountKind: reported
  populationLabel: Undergraduate engineering students in Puducherry, India, aged 18-23, with severe bedtime mobile-phone use
  durationLabel: 30-day intervention with day-15 and day-30 post-tests
  cohortKey: doi-10-55489-njcm-151020244192
  aggregateRole: primary
  notes:
  - "Directness classification: direct_protocol."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: device-type-and-interactivity, safety-burden-life-fit. Year(s): 2024. Deduped proposed keys: source_artifact:doi-10.55489-njcm.151020244192, source_artifact:doi-10.55489/njcm.151020244192. Candidate rationale: Direct app-enforced bedtime phone restriction; useful but lower-priority than indexed randomized trials. Additional shard rationales exist; preserve mixed/directness classifications during extraction."
sourceContext:
  evidenceBucket: direct_protocol_trials_and_registries
  directness: direct_protocol
  claimUse: context-only
  priority: backbone
  batchId: batch-001
  ledgerStudyDesign: pre_post_intervention
  canonicalIdBasis: doi
  artifactRightsStatusGuess: open_access
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **direct_protocol_trials_and_registries** in batch `batch-001`.

## Quick read

One-group pre/post Indian undergraduate study using an app-enforced bedtime phone restriction; useful as direct but uncontrolled context evidence.

## Extracted intervention or exposure

- **Population / N:** Undergraduate engineering students in Puducherry, India, aged 18-23, with severe bedtime mobile-phone use (N=68 ; count kind: selected/recruited from screened severe bedtime mobile-phone users).
- **Intervention / exposure:** Awareness session plus an app-enforced instruction not to use a phone for 30 minutes before typical bedtime; LOCK MY PHONE app lock period set nightly from 9 pm to 5 am, with SMS/call reminders and investigator adherence checks.
- **Comparator / control:** Within-person baseline; no separate randomized or non-intervention control group.
- **Duration / follow-up:** 30-day intervention with day-15 and day-30 post-tests

## Extracted endpoints and results

- **Endpoints:** PSQI sleep quality, PANAS positive and negative affect, MoCA cognitive function, measured at baseline, day 15, and day 30.
- **Effect or direction:** Mean PSQI improved from 10.4 to 6.96 by day 30; positive affect, negative affect, and MoCA scores also changed with reported p<0.001 across time. Only 6/68 were categorized as good sleepers at day 30, so the absolute clinical category change was limited.

## Directness and claim boundary

- **Directness to Digital Sunset:** direct_protocol.
- **Claim use:** context-only.
- **Boundary:** Uncontrolled one-group design, education/reminders bundled with the app lock, narrow undergraduate sample, self-report components, and an internal inconsistency in the abstract/table wording around negative affect. Do not use as causal evidence by itself.

## Safety / adverse events

No adverse events were extracted from the accessible article text. Burden includes phone lock, reminders, and investigator adherence checks.

## Artifact candidates and rights

- **Rights status:** open_access.
- **Artifact note:** Article PDF states Creative Commons Attribution-ShareAlike 4.0; check journal page before storing any binary artifact.

## Extraction cautions

Do not synthesize this source across studies inside the source page. Preserve null, mixed, feasibility-only, protocol-only, and population-mismatch status exactly as extracted.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
