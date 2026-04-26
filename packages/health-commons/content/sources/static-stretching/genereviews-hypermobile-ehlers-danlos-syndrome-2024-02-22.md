---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:genereviews-hypermobile-ehlers-danlos-syndrome-2024-02-22
slug: sources/static-stretching/genereviews-hypermobile-ehlers-danlos-syndrome-2024-02-22
title: Hypermobile Ehlers-Danlos Syndrome
summary: GeneReviews clinical review for hEDS used as a connective-tissue-disorder boundary source rather than a static-stretching efficacy source.
status: draft
quality: usable
aliases:
- Hypermobile Ehlers-Danlos Syndrome
categories:
- static-stretching
relations:
-
  type: related_protocol
  target: protocol_variant:static-stretching/at-home-static-stretching-for-flexibility
-
  type: parent_family
  target: experiment_family:static-stretching
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: https://www.ncbi.nlm.nih.gov/books/NBK1279/
  canonicalUrl: https://www.ncbi.nlm.nih.gov/books/NBK1279/
source:
  kind: guideline
  title: Hypermobile Ehlers-Danlos Syndrome
  authors: Hakim A
  year: 2024
  journal: GeneReviews / NCBI Bookshelf
  citation: Hakim A. Hypermobile Ehlers-Danlos Syndrome. GeneReviews. Updated 2024 Feb 22. NCBI Bookshelf.
  url: https://www.ncbi.nlm.nih.gov/books/NBK1279/
researchEvidence:
  designKind: narrative_review
  designLabel: GeneReviews clinical review
  populationLabel: People with hypermobile Ehlers-Danlos syndrome
  durationLabel: Not applicable; clinical management review
  aggregateRole: synthesis
  cohortKey: genereviews-hypermobile-ehlers-danlos-syndrome-2024-02-22
  notes:
  - 'Intervention/exposure: Management and avoidance guidance for hEDS, joint instability, and hypermobility'
  - 'Comparator/control: No comparator'
  - 'Population mismatch: Diagnosed hEDS population, not generally healthy at-home flexibility users.'
evidenceBucket: safety_guidelines_special_populations
whyItMatters: Boundary source for diagnosed hypermobility/connective-tissue disorder, subluxation/dislocation risk, and exercise modification.
potentialMurphEndpoints:
- caution screening
- contraindications
- joint instability
- subluxation/dislocation risk
- pregnancy caution
protocolTakeaway: Flag hEDS or suspected connective-tissue disorder as a clinician-guidance boundary; do not prescribe generic deep static stretching through lax joints.
murphTakeaway: Use as a safety boundary for hypermobility screening, joint-instability stop rules, and pregnancy/specialist referral cues.
studyDesign: GeneReviews clinical review
modality: Clinical hEDS management and exercise-modification guidance
directness: safety_boundary
populationMismatch: Diagnosed hEDS population, not generally healthy at-home flexibility users.
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **safety_guidelines_special_populations**.

**Findings:** hEDS management emphasizes individualized strengthening, proprioception, and joint-stability work; high-impact activity and treatments that provoke iatrogenic subluxation or dislocation should be avoided.

**Why it matters:** Boundary source for diagnosed hypermobility/connective-tissue disorder, subluxation/dislocation risk, and exercise modification.

**Potential experiment signals:** caution screening, contraindications, joint instability, subluxation/dislocation risk, pregnancy caution.

**Safety notes:** People with hEDS may have chronic pain, joint instability, soft-tissue injury, subluxations, and dislocations; generic end-range stretching is not an appropriate default.

**Limitations:** Narrative clinical review; not a trial of static stretching and not a healthy-adult flexibility protocol.

**Population mismatch:** Diagnosed hEDS population, not generally healthy at-home flexibility users.

**Protocol takeaway:** Flag hEDS or suspected connective-tissue disorder as a clinician-guidance boundary; do not prescribe generic deep static stretching through lax joints.

**Claim use:** `safety-only`.
