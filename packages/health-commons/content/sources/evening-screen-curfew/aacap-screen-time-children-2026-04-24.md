---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:aacap-screen-time-children-2026-04-24"
slug: "sources/evening-screen-curfew/aacap-screen-time-children-2026-04-24"
title: Screen Time and Children
summary: Use for family implementation language with date and evidence-type caveats.
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
  kind: web_page
  title: Screen Time and Children
  authors: American Academy of Child and Adolescent Psychiatry
  year: 2026
  journal: AACAP Facts for Families
  url: "https://www.aacap.org/AACAP/Families_and_Youth/Facts_for_Families/FFF-Guide/Children-And-Watching-TV-054.aspx"
  citation: American Academy of Child and Adolescent Psychiatry. Screen Time and Children. Facts for Families. Source key uses 2026-04-24 retrieval date because page date was not verified in discovery.
researchEvidence:
  designKind: guideline
  designLabel: Guideline
  populationLabel: Children, adolescents, and families.
  durationLabel: "Recommendation: 30 to 60 minutes before bedtime."
  cohortKey: aacap-screen-time-children-2026-04-24
  aggregateRole: synthesis
  notes:
  - "Directness classification: direct_protocol."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: adolescent-family-school, sleep-hygiene-guidelines-bundles. Year(s): 2026. Candidate rationale: Professional child psychiatry advice useful for implementation and family boundary context; date component in source key uses retrieval date because page date was not verified in this discovery pass. Additional shard rationales exist; preserve mixed/directness classifications during extraction."
sourceContext:
  evidenceBucket: screen_media_sleep_reviews_guidelines
  directness: direct_protocol
  claimUse: context-only
  priority: medium
  batchId: batch-003
  ledgerStudyDesign: guideline
  canonicalIdBasis: url
  artifactRightsStatusGuess: open_access
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **screen_media_sleep_reviews_guidelines** in batch `batch-003`.

**Findings:**
- Guidance recommends turning off screens and removing them from bedrooms 30 to 60 minutes before bedtime. (source_artifact:aacap-screen-time-children-2026-04-24)

**Population and exposure:**
-
  Population: Children, adolescents, and families.
- Intervention or exposure: Family screen-time rules including turning off screens and removing them from bedrooms before bedtime.
- Comparator/control: Not applicable.
- Duration/follow-up: Recommendation: 30 to 60 minutes before bedtime.

**Endpoints:** bedtime routine, family screen boundaries

**Adverse events or safety notes:**
- No protocol adverse events were extracted from this source in this batch. (source_artifact:aacap-screen-time-children-2026-04-24)

**Limitations and mismatch:**
- Page date was not verified; source key uses retrieval date. (source_artifact:aacap-screen-time-children-2026-04-24)
- Professional family advice, not a trial. (source_artifact:aacap-screen-time-children-2026-04-24)
- Pediatric/family context. (source_artifact:aacap-screen-time-children-2026-04-24)

**Directness to Digital Sunset No Personal Screens Before Bed:** direct_protocol
**Claim use boundary:** context-only

**Artifact candidates and rights:**
- Ledger rights status guess: `open_access`.
- No copyrighted PDF should be committed to Git. Add only a manifest candidate or metadata unless rights are clearly open and redistributable.

**Protocol takeaway:** Use for family implementation language with date and evidence-type caveats.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
