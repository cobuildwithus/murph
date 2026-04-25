---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:anzctr-rest-o-2024-03-26"
slug: "sources/evening-screen-curfew/anzctr-rest-o-2024-03-26"
title: "Revising Evening Screen Time (REST-O): an online intervention"
summary: ANZCTR registry companion for the REST-O new-career-starter pilot; ledger URL appears mismatched, corrected registry ID preserved in notes.
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
  kind: web_page
  title: "Revising Evening Screen Time (REST-O): an online intervention"
  authors: Australian New Zealand Clinical Trials Registry record; investigators linked to REST-O trial
  year: 2024
  journal: ANZCTR
  url: "https://www.anzctr.org.au/Trial/Registration/TrialReview.aspx?id=387091"
  citation: "Australian New Zealand Clinical Trials Registry. ACTRN12624000105549: Revising Evening Screen Time (REST-O): An online intervention. Registered 7 February 2024; results updated 29 September 2024."
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Registered randomized three-arm online pilot trial
  participantCount: 55
  participantCountKind: reported
  populationLabel: New career starters who finished tertiary study and started full-time work in the previous 12 months, age >18, with bedtime procrastination
  durationLabel: Approximately three-week online pilot with daily diaries and weekly measures
  cohortKey: anzctr-rest-o-2024-03-26
  aggregateRole: primary
  notes:
  - "Directness classification: direct_protocol."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: adult-student-and-work-context. Year(s): 2024. Candidate registry link to publication source_artifact:pmid-40081281; retain separately until verified in extraction. Candidate rationale: Registry companion for the REST-O pilot; useful for planned outcomes, recruitment, and protocol fidelity checks."
sourceContext:
  evidenceBucket: direct_protocol_trials_and_registries
  directness: direct_protocol
  claimUse: context-only
  priority: high
  batchId: batch-001
  ledgerStudyDesign: rct
  canonicalIdBasis: url
  artifactRightsStatusGuess: unknown
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **direct_protocol_trials_and_registries** in batch `batch-001`.

## Quick read

ANZCTR registry companion for the REST-O new-career-starter pilot; ledger URL appears mismatched, corrected registry ID preserved in notes.

## Extracted intervention or exposure

- **Population / N:** New career starters who finished tertiary study and started full-time work in the previous 12 months, age >18, with bedtime procrastination (N=55 ; count kind: final reported/randomized; target was 60).
- **Intervention / exposure:** Active control, Substitute, and Prevent online arms. Substitute targeted bedtime-period alternatives in the 90 minutes before intended bedtime; Prevent moved desired screen-related behaviors earlier than the 90-minute bedtime period.
- **Comparator / control:** Active-control condition with self-monitoring, informational video, coaching/goal setting, and diaries.
- **Duration / follow-up:** Approximately three-week online pilot with daily diaries and weekly measures

## Extracted endpoints and results

- **Endpoints:** PSQI sleep duration and quality, daily bedtime device use, bedtime procrastination, smartphone addiction/dependency, feasibility, and attrition.
- **Effect or direction:** Registry companion to the REST-O pilot; use for planned methods, arms, and fidelity checks rather than independent efficacy claims.

## Directness and claim boundary

- **Directness to Digital Sunset:** direct_protocol.
- **Claim use:** context-only.
- **Boundary:** Registry record, companion to publication, URL mismatch in ledger, and behavioral package is broader than a simple no-screen curfew.

## Safety / adverse events

No adverse events were extracted from the registry record.

## Artifact candidates and rights

- **Rights status:** unknown.
- **Artifact note:** Registry page only. Ledger URL id=386818 opened an unrelated chronic-pain CBT-i record; matching REST-O record was id=387091. Use corrected URL but retain mismatch note.

## Extraction cautions

Do not synthesize this source across studies inside the source page. Preserve null, mixed, feasibility-only, protocol-only, and population-mismatch status exactly as extracted.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
