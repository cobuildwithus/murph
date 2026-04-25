---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.7326/m15-1782"
slug: "sources/evening-screen-curfew/doi-10.7326-m15-1782"
title: "Psychological and Behavioral Interventions for Managing Insomnia Disorder: An Evidence Report for a Clinical Practice Guideline by the American College of Physicians"
summary: ACP evidence report on psychological and behavioral insomnia interventions; included as boundary evidence distinguishing CBT-I and multicomponent insomnia care from a simple screen-curfew habit.
status: draft
quality: usable
categories:
- evening-screen-curfew
- digital-sunset
- sleep-hygiene
- supplemental_sleep_hygiene_insomnia_context
relations:
-
  type: related_protocol
  target: "protocol_variant:evening-screen-curfew/digital-sunset"
-
  type: parent_family
  target: "experiment_family:evening-screen-curfew"
source:
  kind: review
  title: "Psychological and Behavioral Interventions for Managing Insomnia Disorder: An Evidence Report for a Clinical Practice Guideline by the American College of Physicians"
  authors: Brasure M, Fuchs E, MacDonald R, Nelson VA, Koffel E, Olson CM, Khawaja IS, Diem S, Carlyle M, Wilt TJ, Ouellette J, Butler M, Kane RL
  year: 2016
  journal: Annals of Internal Medicine
  pmid: "27136619"
  doi: "10.7326/m15-1782"
  url: "https://www.acpjournals.org/doi/10.7326/M15-1782"
  citation: "Brasure M, Fuchs E, MacDonald R, Nelson VA, Koffel E, Olson CM, Khawaja IS, Diem S, Carlyle M, Wilt TJ, Ouellette J, Butler M, Kane RL. Psychological and Behavioral Interventions for Managing Insomnia Disorder: An Evidence Report for a Clinical Practice Guideline by the American College of Physicians. Ann Intern Med. 2016;165(2):113-124. doi:10.7326/M15-1782."
researchEvidence:
  designKind: systematic_review
  designLabel: "Systematic review/evidence report"
  includedStudyCount: 60
  populationLabel: Adults with insomnia disorder lasting 4 or more weeks
  durationLabel: Search through September 2015; intervention durations varied across trials
  cohortKey: brasure-2016-insomnia-behavioral-evidence-report
  aggregateRole: synthesis
  notes:
  - "Directness classification: adjacent_variant."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: sleep-hygiene-guidelines-bundles. Year(s): 2016. Candidate rationale: Evidence base behind the ACP guideline; useful for boundaries around multi-component CBT-I versus sleep hygiene alone."
sourceContext:
  evidenceBucket: supplemental_sleep_hygiene_insomnia_context
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  batchId: batch-010
  ledgerStudyDesign: systematic_review
  canonicalIdBasis: doi
  artifactRightsStatusGuess: permission_required
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **supplemental sleep-hygiene, insomnia, and broad guidance context** for the Digital Sunset protocol.

## Extraction notes

- **Population:** Adults with insomnia disorder lasting at least 4 weeks in randomized controlled trials.
- **Intervention or exposure:** Psychological and behavioral interventions, especially CBT-I, multicomponent behavioral therapy, and stimulus control.
- **Comparator or control:** Inactive controls or other psychological/behavioral interventions.
- **Duration or follow-up:** Search through September 2015; trial follow-up and treatment duration varied.
- **Endpoints:** global insomnia outcomes, sleep outcomes, sleep onset latency, wake after sleep onset, sleep efficiency, harms
- **Effect estimates or direction:** CBT-I improved posttreatment global and most sleep outcomes versus inactive controls with moderate-strength evidence; multicomponent behavioral therapy and stimulus control improved some outcomes with lower-strength evidence; evidence for other comparisons and harms was insufficient.
- **Adverse events or safety notes:** Evidence for harms was insufficient to permit conclusions in this evidence report.
- **Limitations and population mismatch:** Wide variety of comparisons limited pooling; global outcomes and responder/remitter analyses were not always reported; many controls were information/waitlist; possible publication bias; limited long-term efficacy evidence.
- **Directness to Digital Sunset:** adjacent_variant
- **Claim-use boundary:** context-only
- **Artifact candidates and rights status:** Do not store Annals PDF in Git; metadata/link-only unless redistribution rights are verified.

## Protocol boundary

Use as adjacent clinical boundary evidence; keep digital sunset framed as a low-burden habit experiment, not insomnia therapy.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
