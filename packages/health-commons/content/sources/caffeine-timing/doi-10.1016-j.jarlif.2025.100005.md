---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-j.jarlif.2025.100005
slug: sources/caffeine-timing/doi-10.1016-j.jarlif.2025.100005
title: 'Regular Caffeine Consumption & Subjective Sleep Quality: A Systematic Review'
summary: In a systematic review of 10 studies, regular caffeine consumption showed limited statistically significant associations with subjective sleep quality, with interpretation constrained by heterogeneous study quality, caffeine-exposure definitions, and sleep assessment methods.
status: draft
quality: usable
aliases:
- 'Regular Caffeine Consumption & Subjective Sleep Quality: A Systematic Review'
- source_artifact:doi-10.1016-j.jarlif.2025.100005
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: review
  title: 'Regular Caffeine Consumption & Subjective Sleep Quality: A Systematic Review'
  authors: Duc Minh Phan (Tommy); My Yen Lam; Minh Nguyet Trang
  year: 2025
  journal: Aging Research & Lifestyle
  citation: 'Phan DM, Lam MY, Trang MN. Regular caffeine consumption & subjective sleep quality: a systematic review. Aging Research & Lifestyle. 2025;14:100005. doi:10.1016/j.jarlif.2025.100005.'
  doi: 10.1016/j.jarlif.2025.100005
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC12717775
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1016/j.jarlif.2025.100005
    pmcid: PMC12717775
    titleHash: 94f71cacae674bde8da2fe893d70173e731aa3c097509e68803c0d0059dad267
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC12717775
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC12717775
researchEvidence:
  designKind: systematic_review
  designLabel: Systematic review
  populationLabel: Heterogeneous human studies of regular caffeine consumption and subjective sleep quality.
  durationLabel: Varied across included studies; no 14-day curfew trial.
  aggregateRole: context
  cohortKey: doi-10.1016-j.jarlif.2025.100005-review-context
  notes:
  - 'Intervention or exposure: Regular caffeine consumption; timing and dose measurement varied across included studies.'
  - 'Comparator or control: Lower or no caffeine exposure, or between-person comparisons as reported by included studies.'
  - 'Effect or direction: The review reported limited statistically significant associations and substantial heterogeneity in study quality, exposure measurement, and sleep assessment methods.'
  - 'Safety notes: No protocol-specific adverse-event synthesis was extracted; caffeine sensitivity and timing measurement gaps were highlighted as interpretation issues.'
  - 'Population mismatch: Broad regular-consumption literature, not adults self-running a 14-day caffeine-curfew dose reset.'
  - 'Limitation: Review-level source; not a test of an 8-hour caffeine curfew or 10-11am cutoff.'
  - 'Limitation: Subjective sleep-quality measures and caffeine exposure definitions varied across studies.'
  includedStudyCount: 10
evidenceBucket: systematic_reviews_meta_analyses
whyItMatters: This recent systematic review is useful background for why caffeine timing, dose, and individual sensitivity need to be captured rather than assuming all habitual caffeine exposure has a uniform sleep effect.
potentialMurphEndpoints:
- Subjective sleep-quality rating
- sleep-onset latency
- sleep efficiency
protocolTakeaway: Use as context for heterogeneous regular-caffeine/sleep-quality evidence and measurement gaps, not as direct proof that this exact curfew works.
murphTakeaway: Track dose, timing, and perceived sleep quality together; subjective sleep findings are likely to be noisy without precise exposure logging.
studyDesign: systematic_review
modality: systematic-review-context
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10.1016-j.jarlif.2025.100005-subjective-sleep-mixed
  sourceKey: source_artifact:doi-10.1016-j.jarlif.2025.100005
  extractedFromArtifactId: art_doi-10.1016-j.jarlif.2025.100005_html
  findingKind: context
  population: Heterogeneous human studies of regular caffeine consumption and subjective sleep quality.
  exposure: Regular caffeine consumption; timing and dose measurement varied across included studies.
  outcome: Subjective sleep quality; sleep-quality questionnaires or self-report sleep measures
  summary: In a systematic review of 10 studies, regular caffeine consumption showed limited statistically significant associations with subjective sleep quality, with interpretation constrained by heterogeneous study quality, caffeine-exposure definitions, and sleep assessment methods.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **systematic_reviews_meta_analyses**.

**Findings:** In a systematic review of 10 studies, regular caffeine consumption showed limited statistically significant associations with subjective sleep quality, with interpretation constrained by heterogeneous study quality, caffeine-exposure definitions, and sleep assessment methods.

**Why it matters:** This recent systematic review is useful background for why caffeine timing, dose, and individual sensitivity need to be captured rather than assuming all habitual caffeine exposure has a uniform sleep effect.

**Potential experiment signals:** Subjective sleep-quality rating, sleep-onset latency, sleep efficiency.

**Protocol takeaway:** Use as context for heterogeneous regular-caffeine/sleep-quality evidence and measurement gaps, not as direct proof that this exact curfew works.

**Claim use:** `context-only`.
