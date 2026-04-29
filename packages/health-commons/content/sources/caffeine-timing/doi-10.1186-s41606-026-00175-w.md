---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1186-s41606-026-00175-w
slug: sources/caffeine-timing/doi-10.1186-s41606-026-00175-w
title: 'Effects of caffeine consumption timing on subjective and objective sleep onset and dream recall in Indian young adults: a mixed-methods study with cultural and occupational moderators'
summary: A 2026 mixed-methods cross-sectional study of Indian young adults found later-than-18:00 caffeine users reported and showed longer sleep-onset latency and lower dream recall, but it cannot establish causal curfew effects.
status: draft
quality: usable
aliases:
- 'Effects of caffeine consumption timing on subjective and objective sleep onset and dream recall in Indian young adults: a mixed-methods study with cultural and occupational moderators'
- source_artifact:doi-10.1186-s41606-026-00175-w
- doi:10.1186/s41606-026-00175-w
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: journal_article
  title: 'Effects of caffeine consumption timing on subjective and objective sleep onset and dream recall in Indian young adults: a mixed-methods study with cultural and occupational moderators'
  authors: Sagar Bayaskar; Deepak Sharma
  year: 2026
  journal: Sleep Science and Practice
  citation: 'Bayaskar S, Sharma D. Effects of caffeine consumption timing on subjective and objective sleep onset and dream recall in Indian young adults: a mixed-methods study with cultural and occupational moderators. Sleep Sci Pract. 2026;10:16. doi:10.1186/s41606-026-00175-w.'
  doi: 10.1186/s41606-026-00175-w
  url: https://link.springer.com/article/10.1186/s41606-026-00175-w
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1186/s41606-026-00175-w
    titleHash: 4b0a99f9dd9f779a9e4e54e4ca0b3547a23fa37d5f08fd86b261441e50d11360
    url: https://link.springer.com/article/10.1186/s41606-026-00175-w
  canonicalUrl: https://link.springer.com/article/10.1186/s41606-026-00175-w
researchEvidence:
  designKind: cross_sectional
  designLabel: Sequential mixed-methods cross-sectional study with 7-night actigraphy subset
  participantCount: 200
  populationLabel: Healthy Indian young adults aged 18-35 years from Maharashtra, including students and professionals.
  durationLabel: Cross-sectional interviews/questionnaires plus 7-night actigraphy subset.
  aggregateRole: primary
  cohortKey: doi-10-1186-s41606-026-00175-w-healthy-indian-young-adults-aged-18-35-years-from-maharashtra-including-students-and-prof
  notes:
  - 'Intervention or exposure: Self-selected late caffeine intake after 18:00 versus early/no late intake.'
  - 'Comparator or control: Early/no late caffeine group.'
  - 'Endpoints: Subjective sleep-onset latency, actigraphy sleep-onset latency, WASO, total sleep time, and dream recall.'
  - 'Effect or direction: Late intake was associated with longer perceived SOL (46.2 ± 12.1 vs 19.8 ± 6.3 min; p<0.001); objective actigraphy SOL was also longer in the late group, with available extracts reporting roughly 29-31 min vs 16.1 min.'
  - 'Additional result: Dream recall frequency was lower with late caffeine (5.6 ± 1.1 to 2.9 ± 1.4 days/week in extracted report) and inversely correlated with WASO (r=-0.61; p<0.001).'
  - 'Safety notes: No adverse-event extraction beyond sleep disruption outcomes.'
  - 'Limitations: Cross-sectional and self-selected exposure; extracted snippets showed inconsistent objective SOL values across abstract/table text, so the exact objective estimate should be verified from the full article before protocol synthesis.'
  - 'Population mismatch: Indian young adults; not a 14-day adult dose-reset intervention and not a morning-only cutoff.'
  - 'Directness to target protocol: Adjacent clock-time/timing context only.'
evidenceBucket: adjacent_curfew_morning_evening_context
whyItMatters: It provides recent clock-time context for late-evening caffeine and sleep-onset outcomes, while highlighting occupational and student moderators.
potentialMurphEndpoints:
- Subjective sleep-onset latency
- Actigraphy sleep-onset latency
- Wake after sleep onset
- Dream recall frequency
protocolTakeaway: 'Adjacent evidence only: the exposure was caffeine after 18:00 and the design was observational, so it cannot prove a 10-11am or 8-hour-bedtime caffeine curfew.'
murphTakeaway: Late caffeine may be a real-world sleep-onset risk signal for some students/professionals, but user-level experiments should avoid causal claims from this study alone.
studyDesign: sequential mixed-methods cross-sectional study with 7-night actigraphy subset
modality: mixed-methods-actigraphy
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10.1186-s41606-026-00175-w-late-caffeine-sleep-onset
  sourceKey: source_artifact:doi-10.1186-s41606-026-00175-w
  extractedFromArtifactId: art_doi_10_1186_s41606_026_00175_w_pubmed
  findingKind: context
  population: Healthy Indian young adults aged 18-35 years (N=200; actigraphy subset N=50).
  exposure: Self-reported caffeine intake after 18:00.
  outcome: Subjective and actigraphy-estimated sleep-onset latency, WASO, total sleep time, and dream recall.
  summary: Late caffeine after 18:00 was associated with longer subjective sleep-onset latency and longer objective actigraphy-estimated sleep onset in a cross-sectional mixed-methods study; the design does not establish causality.
  evidenceUse:
  - adjacent_variant
  - context
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **adjacent_curfew_morning_evening_context**.

**Findings:** Late caffeine after 18:00 was associated with longer subjective sleep-onset latency and longer objective actigraphy-estimated sleep onset in a cross-sectional mixed-methods study; the design does not establish causality.

**Why it matters:** It provides recent clock-time context for late-evening caffeine and sleep-onset outcomes, while highlighting occupational and student moderators.

**Potential experiment signals:** Subjective sleep-onset latency; Actigraphy sleep-onset latency; Wake after sleep onset; Dream recall frequency.

**Protocol takeaway:** Adjacent evidence only: the exposure was caffeine after 18:00 and the design was observational, so it cannot prove a 10-11am or 8-hour-bedtime caffeine curfew.

**Claim use:** `context-only`.
