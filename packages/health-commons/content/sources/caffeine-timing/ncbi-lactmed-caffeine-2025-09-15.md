---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ncbi-lactmed-caffeine-2025-09-15
slug: sources/caffeine-timing/ncbi-lactmed-caffeine-2025-09-15
title: Caffeine
summary: LactMed clinical summary on caffeine during lactation, including infant symptoms at very high maternal intake, slower newborn/preterm metabolism, and authority dose ranges.
status: draft
quality: usable
aliases:
- LactMed caffeine
- Caffeine LactMed
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: other
  title: Caffeine
  authors: Drugs and Lactation Database (LactMed®), National Library of Medicine
  year: 2025
  journal: NCBI Bookshelf
  citation: Drugs and Lactation Database (LactMed®). Caffeine. Updated September 15, 2025.
  url: https://www.ncbi.nlm.nih.gov/books/NBK501467
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 9251f129e36d22db1b07c86a83bc9268948d98bd80be3b9c6eb8c48ed0ef22ac
    url: https://www.ncbi.nlm.nih.gov/books/NBK501467
  canonicalUrl: https://www.ncbi.nlm.nih.gov/books/NBK501467
researchEvidence:
  designKind: guideline
  designLabel: NCBI Bookshelf clinical lactation summary
  populationLabel: Breastfeeding people and infants
  durationLabel: Lactation exposure context
  aggregateRole: primary
  cohortKey: ncbi-lactmed-caffeine-2025-09-15
evidenceBucket: clinical_safety_boundaries
whyItMatters: Directly informs lactation-specific safety boundaries and highlights that infant age/preterm status changes caffeine exposure risk.
potentialMurphEndpoints:
- biomarker:caffeine-dose
- biomarker:infant-sleep
- biomarker:adverse-events
protocolTakeaway: Breastfeeding users, especially with newborn or preterm infants, need lactation-aware caffeine guidance rather than a generic curfew reset.
murphTakeaway: High-priority lactation boundary and infant-symptom monitoring source.
studyDesign: NCBI Bookshelf clinical lactation summary
modality: caffeine safety boundary
claimUse: safety-only
limitations:
- Clinical summary based on limited heterogeneous evidence; not a protocol timing trial.
populationMismatch: Lactation dyads differ from general adult sleep self-experimenters.
directnessToProtocol: clinical_supervised
sourceFindings:
- findingId: finding:ncbi-lactmed-caffeine-2025-09-15-01
  sourceKey: source_artifact:ncbi-lactmed-caffeine-2025-09-15
  extractedFromArtifactId: art_ncbi_lactmed_caffeine_2025_09_15_html
  findingKind: safety
  population: Breastfeeding dyads
  exposure: Maternal caffeine intake
  outcome: Infant fussiness, jitteriness, and poor sleep at very high maternal intake
  summary: LactMed reports that infant fussiness, jitteriness, and poor sleep have been reported with very high maternal caffeine intake equivalent to about 10 or more cups of coffee daily, while studies of 5 cups/day found no stimulation in breastfed infants 3 weeks of age and older.
  evidenceUse:
  - safety
- findingId: finding:ncbi-lactmed-caffeine-2025-09-15-02
  sourceKey: source_artifact:ncbi-lactmed-caffeine-2025-09-15
  extractedFromArtifactId: art_ncbi_lactmed_caffeine_2025_09_15_html
  findingKind: safety
  population: Breastfeeding people and infants, especially newborns/preterm infants
  exposure: Maternal caffeine intake
  outcome: Dose-limit ranges and infant slow metabolism
  summary: LactMed summarizes that maternal intakes of 300-500 mg/day might be safe for most mothers of full-term healthy infants, European authorities recommend 200 mg/day, and lower intake is preferable for mothers of preterm or newborn infants because they metabolize caffeine very slowly.
  evidenceUse:
  - safety
- findingId: finding:ncbi-lactmed-caffeine-2025-09-15-03
  sourceKey: source_artifact:ncbi-lactmed-caffeine-2025-09-15
  extractedFromArtifactId: art_ncbi_lactmed_caffeine_2025_09_15_html
  findingKind: mechanistic
  population: Breastfeeding dyads
  exposure: Caffeine transfer into breastmilk
  outcome: Rapid appearance in milk and infant exposure timing
  summary: LactMed states that caffeine appears in breastmilk rapidly after maternal ingestion and commonly peaks in milk about one hour after a maternal dose.
  evidenceUse:
  - mechanism
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **clinical_safety_boundaries**.

**Findings:**
- `finding:ncbi-lactmed-caffeine-2025-09-15-01`: LactMed reports that infant fussiness, jitteriness, and poor sleep have been reported with very high maternal caffeine intake equivalent to about 10 or more cups of coffee daily, while studies of 5 cups/day found no stimulation in breastfed infants 3 weeks of age and older.
- `finding:ncbi-lactmed-caffeine-2025-09-15-02`: LactMed summarizes that maternal intakes of 300-500 mg/day might be safe for most mothers of full-term healthy infants, European authorities recommend 200 mg/day, and lower intake is preferable for mothers of preterm or newborn infants because they metabolize caffeine very slowly.
- `finding:ncbi-lactmed-caffeine-2025-09-15-03`: LactMed states that caffeine appears in breastmilk rapidly after maternal ingestion and commonly peaks in milk about one hour after a maternal dose.

**Why it matters:** Directly informs lactation-specific safety boundaries and highlights that infant age/preterm status changes caffeine exposure risk.

**Potential experiment signals:**
- biomarker:caffeine-dose
- biomarker:infant-sleep
- biomarker:adverse-events

**Protocol takeaway:** Breastfeeding users, especially with newborn or preterm infants, need lactation-aware caffeine guidance rather than a generic curfew reset.

**Claim use:** `safety-only`.
