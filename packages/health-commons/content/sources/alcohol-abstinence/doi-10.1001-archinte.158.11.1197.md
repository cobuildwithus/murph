---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1001-archinte.158.11.1197
slug: sources/alcohol-abstinence/doi-10.1001-archinte.158.11.1197
title: 'Prevention and Treatment of Hypertension Study (PATHS): Effects of an Alcohol Treatment Program on Blood Pressure'
summary: 'Large multicenter PATHS alcohol-reduction RCT in mostly male veterans: alcohol intake fell substantially, but the between-group blood-pressure difference was small and not statistically significant.'
status: draft
quality: usable
aliases:
- PATHS alcohol treatment blood pressure
- Cushman 1998 PATHS alcohol reduction
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
  title: 'Prevention and Treatment of Hypertension Study (PATHS): Effects of an Alcohol Treatment Program on Blood Pressure'
  authors: Cushman WC; Cutler JA; Hanna E; Bingham SF; Follmann D; Harford T; Dubbert P; Allender PS; Dufour M; Collins JF; Walsh SM; Kirk GF; Burg M; Felicetta JV; Hamilton BP; Katz LA; Perry HM Jr; Willenbring ML; Lakshman R; Hamburger RJ; for the PATHS Group
  year: 1998
  journal: Archives of Internal Medicine
  citation: 'Cushman WC, Cutler JA, Hanna E, Bingham SF, Follmann D, Harford T, et al.; PATHS Group. Prevention and Treatment of Hypertension Study (PATHS): effects of an alcohol treatment program on blood pressure. Arch Intern Med. 1998;158(11):1197-1207. doi:10.1001/archinte.158.11.1197.'
  doi: 10.1001/archinte.158.11.1197
  url: https://doi.org/10.1001/archinte.158.11.1197
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1001/archinte.158.11.1197
    titleHash: a4f0dfc70ac8c8b9662a0095b4674756c63c4b2a2f69f0a497912d9f54ad7200
    url: https://doi.org/10.1001/archinte.158.11.1197
  canonicalUrl: https://doi.org/10.1001/archinte.158.11.1197
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Multicenter randomized controlled alcohol-reduction intervention trial
  participantCount: 641
  participantCountKind: reported
  populationLabel: Outpatient veterans who drank an average of at least three drinks per day, were nondependent, and had high-normal or mildly hypertensive diastolic blood pressure; only five women were randomized.
  durationLabel: Alcohol-reduction intervention with six-month primary blood-pressure endpoint and follow-up through 15 to 24 months.
  aggregateRole: primary
  cohortKey: paths-veterans-alcohol-reduction-bp
evidenceBucket: alcohol-reduction comparator and reducer triage evidence
whyItMatters: It is a large alcohol-reduction comparator for blood pressure and alcohol-intake endpoints, but it is not a 7-, 14-, or 30-day alcohol-free challenge.
potentialMurphEndpoints:
- self-reported alcohol intake
- blood pressure
- hypertension incidence
- gamma-glutamyltransferase
- apolipoproteins
- cardiovascular events
protocolTakeaway: 'Use as adjacent reduction evidence: PATHS shows a structured program can reduce intake, but the extracted primary blood-pressure difference was small and non-significant, so it should not be used as a direct abstinence BP claim.'
murphTakeaway: Good comparator context for tracking alcohol intake and BP, with a caution that meaningful intake reduction did not translate into a clear BP treatment effect in this veteran sample.
studyDesign: Randomized alcohol-reduction counseling program versus observation/control in a multicenter veteran hypertension-prevention/treatment trial.
modality: clinical cognitive-behavioral alcohol-reduction intervention
claimUse: context-only
sourceFindings:
-
  findingId: finding:doi-10.1001-archinte.158.11.1197-alcohol-reduction-achieved
  sourceKey: source_artifact:doi-10.1001-archinte.158.11.1197
  extractedFromArtifactId: art_doi_10_1001_archinte_158_11_1197
  findingKind: intervention_result
  population: Outpatient veterans drinking at least three drinks per day on average with high-normal or mildly hypertensive diastolic blood pressure.
  exposure: Cognitive-behavioral alcohol-reduction program targeting either no more than two drinks per day or at least a 50% reduction, compared with observation/control.
  outcome: Alcohol intake reduction.
  summary: PATHS achieved substantially greater reductions in self-reported alcohol intake than control across follow-up; during the first six months the average reduction was about 202 g/week in the intervention group versus 78 g/week in controls.
  evidenceUse:
  - adjacent_variant
  - efficacy
  - measurement
-
  findingId: finding:doi-10.1001-archinte.158.11.1197-bp-effect-small-nonsignificant
  sourceKey: source_artifact:doi-10.1001-archinte.158.11.1197
  extractedFromArtifactId: art_doi_10_1001_archinte_158_11_1197
  findingKind: intervention_result
  population: PATHS randomized veteran cohort with blood-pressure follow-up available.
  exposure: Alcohol-reduction program versus observation/control.
  outcome: Blood pressure at six months.
  summary: The six-month between-group blood-pressure difference was small and not statistically significant, about 1.2/0.7 mm Hg overall; this does not support using alcohol reduction alone as a hypertension treatment claim.
  evidenceUse:
  - adjacent_variant
  - measurement
-
  findingId: finding:doi-10.1001-archinte.158.11.1197-cv-events-similar
  sourceKey: source_artifact:doi-10.1001-archinte.158.11.1197
  extractedFromArtifactId: art_doi_10_1001_archinte_158_11_1197
  findingKind: safety
  population: PATHS randomized veteran cohort.
  exposure: Alcohol-reduction program versus observation/control.
  outcome: Deaths and cardiovascular events.
  summary: Safety signals extracted from the article were similar across groups, with six versus five deaths and 18 versus 17 cardiovascular events in intervention versus control groups.
  evidenceUse:
  - safety
  - adjacent_variant
murphV1Priority: High
pdfRightsStatus: permission_required
---


This source is included for **Alcohol-reduction comparator trials, digital interventions, and liver-focused protocols**.

**Findings:**
- `finding:doi-10.1001-archinte.158.11.1197-alcohol-reduction-achieved` — PATHS achieved substantially greater reductions in self-reported alcohol intake than control across follow-up; during the first six months the average reduction was about 202 g/week in the intervention group versus 78 g/week in controls.
- `finding:doi-10.1001-archinte.158.11.1197-bp-effect-small-nonsignificant` — The six-month between-group blood-pressure difference was small and not statistically significant, about 1.2/0.7 mm Hg overall; this does not support using alcohol reduction alone as a hypertension treatment claim.
- `finding:doi-10.1001-archinte.158.11.1197-cv-events-similar` — Safety signals extracted from the article were similar across groups, with six versus five deaths and 18 versus 17 cardiovascular events in intervention versus control groups.

**Why it matters:** It is a large alcohol-reduction comparator for blood pressure and alcohol-intake endpoints, but it is not a 7-, 14-, or 30-day alcohol-free challenge.

**Potential experiment signals:** self-reported alcohol intake, blood pressure, hypertension incidence, gamma-glutamyltransferase, apolipoproteins, cardiovascular events.

**Protocol takeaway:** Use as adjacent reduction evidence: PATHS shows a structured program can reduce intake, but the extracted primary blood-pressure difference was small and non-significant, so it should not be used as a direct abstinence BP claim.

**Claim use:** `context-only`.

**Limitations and population mismatch:** Adjacent reduction protocol rather than complete abstinence; predominantly male veteran sample; nondependent moderate-to-heavy drinkers; BP endpoint was six months, not short challenge durations; BP effect was small and non-significant; no 7-, 14-, or 30-day abstinence variant is isolated.

**Artifact candidates and rights:** `art_doi_10_1001_archinte_158_11_1197` is a metadata-only artifact candidate. `pdfRightsStatus` is `permission_required`; do not commit copyrighted PDFs unless the specific file license is verified as redistributable.
