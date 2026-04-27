---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1080-07347324.2024.2419616
slug: sources/alcohol-abstinence/doi-10.1080-07347324.2024.2419616
title: Preliminary Results of a Voluntary One-Month Abstinence Program on Drinking Refusal Self-Efficacy and Craving
summary: Preliminary one-month abstinence-program survey reporting increased drinking-refusal self-efficacy among successful completers and no significant craving change.
status: draft
quality: usable
aliases:
- Dry November one-month abstinence DRSE and craving
- Nagy 2025 one-month alcohol abstinence
categories:
- alcohol-abstinence
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
source:
  kind: journal_article
  title: Preliminary Results of a Voluntary One-Month Abstinence Program on Drinking Refusal Self-Efficacy and Craving
  authors: Nagy N; Rácz J; Urbán R; Horváth Z
  year: 2025
  journal: Alcoholism Treatment Quarterly
  citation: Nagy N, Rácz J, Urbán R, Horváth Z. Preliminary Results of a Voluntary One-Month Abstinence Program on Drinking Refusal Self-Efficacy and Craving. Alcoholism Treatment Quarterly. 2025;43(2):1-11. doi:10.1080/07347324.2024.2419616.
  doi: 10.1080/07347324.2024.2419616
  url: https://doi.org/10.1080/07347324.2024.2419616
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1080/07347324.2024.2419616
    titleHash: 23b5823671f569b2bfe1926eb46db1bc9dd6aa7b79649335ad5573e07f82acb1
    url: https://doi.org/10.1080/07347324.2024.2419616
  canonicalUrl: https://doi.org/10.1080/07347324.2024.2419616
researchEvidence:
  designKind: prospective_cohort
  designLabel: Preliminary longitudinal survey / single-arm pre-post analysis of successful completers
  participantCount: 27
  participantCountKind: reported
  populationLabel: Participants who successfully completed a voluntary one-month alcohol abstinence program; self-selected completer population.
  durationLabel: One month voluntary abstinence program.
  aggregateRole: primary
  cohortKey: one-month-abstinence-completers
evidenceBucket: direct short-term complete abstinence and duration evidence
whyItMatters: Directly measures drinking-refusal self-efficacy and craving during a one-month abstinence program, matching a 30-day challenge endpoint family.
potentialMurphEndpoints:
- drinking-refusal self-efficacy
- alcohol craving
- completion
- subjective experience
protocolTakeaway: One-month abstinence completers showed improved drinking-refusal self-efficacy, while craving change was not significant in the extracted report; use as direct but preliminary mood/craving evidence.
murphTakeaway: Useful for tracking confidence-to-refuse and craving before/after a 30-day challenge, but not proof that craving reliably falls for all participants.
studyDesign: Single-arm longitudinal survey of a voluntary one-month abstinence program; no non-abstinence control extracted.
modality: one-month voluntary alcohol abstinence challenge
claimUse: supports-protocol
sourceFindings:
-
  findingId: finding:doi-10.1080-07347324.2024.2419616-drse-increased
  sourceKey: source_artifact:doi-10.1080-07347324.2024.2419616
  extractedFromArtifactId: art_doi_10_1080_07347324_2024_2419616
  findingKind: intervention_result
  population: Successful completers of a voluntary one-month alcohol abstinence program.
  exposure: One month voluntary alcohol abstinence.
  outcome: Drinking-refusal self-efficacy.
  summary: Drinking-refusal self-efficacy significantly increased by the end of the one-month abstinence program among the 27 successful completers in the extracted report.
  evidenceUse:
  - efficacy
  - measurement
-
  findingId: finding:doi-10.1080-07347324.2024.2419616-craving-nonsignificant
  sourceKey: source_artifact:doi-10.1080-07347324.2024.2419616
  extractedFromArtifactId: art_doi_10_1080_07347324_2024_2419616
  findingKind: intervention_result
  population: Successful completers of a voluntary one-month alcohol abstinence program.
  exposure: One month voluntary alcohol abstinence.
  outcome: Alcohol craving.
  summary: Craving did not show a significant end-of-program change in the extracted report, so craving improvement should not be claimed as a reliable direct effect from this source.
  evidenceUse:
  - efficacy
  - measurement
murphV1Priority: High
pdfRightsStatus: permission_required
---


This source is included for **Direct protocol and duration evidence**.

**Findings:**
- `finding:doi-10.1080-07347324.2024.2419616-drse-increased` — Drinking-refusal self-efficacy significantly increased by the end of the one-month abstinence program among the 27 successful completers in the extracted report.
- `finding:doi-10.1080-07347324.2024.2419616-craving-nonsignificant` — Craving did not show a significant end-of-program change in the extracted report, so craving improvement should not be claimed as a reliable direct effect from this source.

**Why it matters:** Directly measures drinking-refusal self-efficacy and craving during a one-month abstinence program, matching a 30-day challenge endpoint family.

**Potential experiment signals:** drinking-refusal self-efficacy, alcohol craving, completion, subjective experience.

**Protocol takeaway:** One-month abstinence completers showed improved drinking-refusal self-efficacy, while craving change was not significant in the extracted report; use as direct but preliminary mood/craving evidence.

**Claim use:** `supports-protocol`.

**Limitations and population mismatch:** Small completer sample; no randomized or non-abstinence control extracted; self-selected voluntary-program participants; not a 7-day or 14-day variant; no adverse-event extraction found. Population mismatch: Completers in a voluntary program may be more motivated than Murph users who attempt a challenge without program support.
