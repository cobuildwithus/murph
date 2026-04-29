---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:gi-symptom-score
slug: biomarkers/gi-symptom-score
title: GI Symptom Score
summary: A low-burden manual safety score for gastrointestinal tolerance during supplement experiments.
status: field-testing
quality: usable
aliases:
- gastrointestinal symptoms
- GI tolerance
- stomach upset score
- digestive symptom score
categories:
- manual-metric
- safety
- supplement
- collagen-supplementation
measurementContexts:
- daily_manual_checkin
- safety_checkin
unit: 0–10 symptom burden
interpretationFrame:
  principle: Compare daily symptom burden against baseline and stop or reassess if symptoms are persistent, worsening, or disruptive.
  caveat: GI symptoms can be caused by diet, illness, stress, medications, sweeteners, protein load, or unrelated conditions.
biomarker:
  shortName: GI symptoms
  displayName: GI Symptom Score
  unit: 0–10
  valuePrecision: 0
  direction:
    desired: lower_or_stable
    label: Lower or stable is preferred.
    nuance: Any persistent or worsening digestive symptoms should be interpreted as a safety/tolerability signal, not as a normal adjustment period by default.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 5
    aggregation: median
  explainerCards:

  -
    title: What it is
    body: A daily manual score for nausea, bloating, abdominal discomfort, diarrhea, constipation, reflux, or other digestive symptoms.
  -
    title: Why it matters
    body: GI tolerance is one of the practical safety signals to track for oral supplement experiments.
  measurement:
    bestContext: Daily during baseline and intervention, ideally near the same time each day.
    howToMeasure:
    - Score overall GI symptom burden from 0 to 10.
    - Add a short note for the main symptom if above baseline.
    - Mark diet, illness, alcohol, medication, and product changes.
    confounders:
    - diet change
    - illness
    - alcohol
    - medication change
    - sweeteners or coingredients
    - protein load
    - travel
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: cites
  target: source_artifact:pmid-40507417
-
  type: cites
  target: source_artifact:pmid-30061579
-
  type: cites
  target: source_artifact:pmid-36912494
-
  type: cites
  target: source_artifact:pmid-40685650
-
  type: cites
  target: source_artifact:pmid-11071580
---

# GI Symptom Score

GI symptoms are a practical tolerability signal for oral collagen-peptide runs. The score should be compared with baseline and interpreted alongside diet, illness, medication, product, and coingredient changes.
