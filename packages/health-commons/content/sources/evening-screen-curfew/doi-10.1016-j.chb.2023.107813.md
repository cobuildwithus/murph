---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1016/j.chb.2023.107813"
slug: "sources/evening-screen-curfew/doi-10.1016-j.chb.2023.107813"
title: '"Using digital media or sleeping ... that is the question". A meta-analysis on digital media use and unhealthy sleep in adolescence'
summary: Use for adolescent context and bidirectionality, not as direct protocol evidence.
status: draft
quality: usable
categories:
- evening-screen-curfew
- digital-sunset
- screen-media-sleep-reviews-guidelines
- screen_media_sleep_reviews_guidelines
relations:
-
  type: related_protocol
  target: "protocol_variant:evening-screen-curfew/digital-sunset"
-
  type: parent_family
  target: "experiment_family:evening-screen-curfew"
source:
  kind: review
  title: '"Using digital media or sleeping ... that is the question". A meta-analysis on digital media use and unhealthy sleep in adolescence'
  authors: Pagano M, Bacaro V, Crocetti E
  year: 2023
  journal: Computers in Human Behavior
  doi: "10.1016/j.chb.2023.107813"
  url: "https://doi.org/10.1016/j.chb.2023.107813"
  citation: "Pagano M, Bacaro V, Crocetti E. \"Using digital media or sleeping ... that is the question\". A meta-analysis on digital media use and unhealthy sleep in adolescence. Comput Human Behav. 2023;146:107813. doi:10.1016/j.chb.2023.107813."
researchEvidence:
  designKind: meta_analysis
  designLabel: Meta Analysis
  participantCount: 116431
  participantCountKind: reported
  populationLabel: Adolescents in longitudinal studies; baseline mean age approximately 13.4 years in the extracted abstract.
  durationLabel: Longitudinal follow-up varied across studies.
  cohortKey: doi-10.1016-j.chb.2023.107813
  aggregateRole: synthesis
  notes:
  - "Directness classification: background."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: adolescent-family-school, bedtime-procrastination-displacement, sleep-hygiene-guidelines-bundles. Year(s): 2023. Deduped proposed keys: source_artifact:doi-10.1016-j.chb.2023.107813, source_artifact:doi-10.1016/j.chb.2023.107813. Candidate rationale: Meta-analysis focused on digital media and unhealthy sleep in adolescence; helpful background and boundary source. Additional shard rationales exist; preserve mixed/directness classifications during extraction."
sourceContext:
  evidenceBucket: screen_media_sleep_reviews_guidelines
  directness: background
  claimUse: context-only
  priority: high
  batchId: batch-003
  ledgerStudyDesign: meta_analysis
  canonicalIdBasis: doi
  artifactRightsStatusGuess: open_access
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **screen_media_sleep_reviews_guidelines** in batch `batch-003`.

**Findings:**
- Media use was negatively related to later sleep health: traditional media r = -0.33, social media r = -0.12, prolonged use r = -0.06, dysfunctional use r = -0.19. (source_artifact:doi-10.1016/j.chb.2023.107813)
- Sleep patterns were not related to subsequent social media use or utilization time, but were related to dysfunctional media use. (source_artifact:doi-10.1016/j.chb.2023.107813)

**Population and exposure:**
-
  Population: Adolescents in longitudinal studies; baseline mean age approximately 13.4 years in the extracted abstract.
- Intervention or exposure: Traditional media use, social media use, prolonged media use, and dysfunctional digital media use.
- Comparator/control: Lower exposure/use categories; longitudinal sleep-to-media paths also examined.
- Duration/follow-up: Longitudinal follow-up varied across studies.

**Endpoints:** sleep health, sleep patterns, later media use

**Adverse events or safety notes:**
- No protocol adverse events were extracted from this source in this batch. (source_artifact:doi-10.1016/j.chb.2023.107813)

**Limitations and mismatch:**
- Adolescent longitudinal associations; not a curfew trial. (source_artifact:doi-10.1016/j.chb.2023.107813)
- Longitudinal associations do not by themselves establish intervention efficacy. (source_artifact:doi-10.1016/j.chb.2023.107813)
- Media categories do not map one-to-one to personal screens before bed. (source_artifact:doi-10.1016/j.chb.2023.107813)

**Directness to Digital Sunset No Personal Screens Before Bed:** background
**Claim use boundary:** context-only

**Artifact candidates and rights:**
- Ledger rights status guess: `open_access`.
- No copyrighted PDF should be committed to Git. Add only a manifest candidate or metadata unless rights are clearly open and redistributable.

**Protocol takeaway:** Use for adolescent context and bidirectionality, not as direct protocol evidence.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
