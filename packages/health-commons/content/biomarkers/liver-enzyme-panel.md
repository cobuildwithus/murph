---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:liver-enzyme-panel
slug: biomarkers/liver-enzyme-panel
title: Liver Enzyme Panel
summary: Optional laboratory context such as GGT, ALT, AST, and related liver markers before and after a longer alcohol-free challenge; useful for consistent tracking but not a liver-disease treatment claim.
status: draft
quality: usable
aliases:
- liver enzymes
- liver function tests
- LFTs
- hepatic panel
categories:
- alcohol-abstinence
- lab-marker
- liver
- clinical-context
measurementContexts:
- baseline_lab
- post_challenge_lab
- clinician_ordered_lab
- thirty_day_challenge_optional
unit: lab-specific units
interpretationFrame:
  principle: Use labs only when measured consistently and interpreted against clinical reference ranges, medications, illness, body weight, and the reason testing was ordered.
  caveat: Normal-range movement is not proof of liver repair, and abnormal values or known liver disease require clinician interpretation rather than a wellness challenge conclusion.
biomarker:
  shortName: Liver enzymes
  displayName: Liver Enzyme Panel
  unit: varies by analyte
  valuePrecision: 1
  direction:
    desired: mixed_or_contextual
    label: Lower abnormal alcohol-sensitive markers can be encouraging, but interpretation depends on baseline status and clinical context.
    nuance: Do not compare isolated ALT, AST, or GGT values without the lab range, timing, medications, illness, and clinician context.
  privateMetricBindings:

  -
    source: browser_vault_metric
    domain: body_state
    metric: ggt
    unit: U/L
    preferred: true
  -
    source: browser_vault_metric
    domain: body_state
    metric: alt
    unit: U/L
  -
    source: browser_vault_metric
    domain: body_state
    metric: ast
    unit: U/L
  trendDefaults:
    latestWindowDays: 45
    comparisonWindowDays: 90
    minimumPoints: 2
    aggregation: median
  measurement:
    bestContext: Clinician-ordered or otherwise consistently collected lab panels before and after the 30-day variant, with the same lab and reference range when possible.
    howToMeasure:
    - Use the liver-enzyme panel only as an optional secondary signal, mainly for the 30-day challenge.
    - Record date, fasting status if relevant, lab reference range, recent illness, intense exercise, medications, supplements, and weight change.
    - 'Compare like with like: the same analyte, lab, units, and similar timing relative to the challenge.'
    - Treat abnormal results, known liver disease, jaundice, right-upper-quadrant pain, or other concerning symptoms as clinical issues rather than experiment outcomes.
    - Do not use normal-range changes to claim treatment, diagnosis, or organ repair.
    confounders:
    - baseline liver disease
    - viral hepatitis
    - metabolic syndrome
    - weight change
    - medications
    - supplements
    - recent intense exercise
    - acute illness
    - binge drinking before the test
    - different labs or reference ranges
    - fasting status
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
-
  type: cites
  target: source_artifact:pmid-29726886
-
  type: cites
  target: source_artifact:pmid-29730627
-
  type: cites
  target: source_artifact:pmid-41399621
-
  type: cites
  target: source_artifact:pmid-41899181
claims:
-
  claimId: one-month-liver-marker-context
  type: evidence_scope
  text: Direct one-month abstinence sources support liver-enzyme panels as optional context for longer challenges, but they should not be used to claim liver-disease treatment or broad organ repair.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-29726886
  - source_artifact:pmid-29730627
  caveats:
  - Study populations, baseline drinking levels, and lab status may not match a self-guided wellness user.
-
  claimId: liver-disease-boundary
  type: safety
  text: Known or suspected liver disease belongs in clinician-guided care; adjacent liver-marker sources should not be converted into a self-treatment claim for this protocol.
  strength: high
  sourceKeys:
  - source_artifact:pmid-41399621
  - source_artifact:pmid-41899181
  caveats:
  - These sources are adjacent liver context, not direct 7-, 14-, or 30-day wellness challenge evidence for treating disease.
---


## How to use this

The liver enzyme panel is optional. It is most defensible for the 30-day version when a user already has access to comparable labs or is measuring for another appropriate reason.

## What it does not show

This page does not turn a wellness abstinence challenge into liver-disease treatment. Abnormal results, symptoms, or known liver disease require clinician interpretation.
