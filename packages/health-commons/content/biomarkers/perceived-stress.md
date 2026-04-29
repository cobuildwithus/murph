---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:perceived-stress
slug: biomarkers/perceived-stress
title: Perceived Stress
summary: A simple same-day self-rating that is currently the clearest primary user-facing signal for a cautious cold-plunge experiment.
status: draft
quality: usable
aliases:
  - subjective stress
  - stress rating
categories:
  - stress
  - self-report
  - manual-checkin
relations:

  -
    type: related_protocol
    target: protocol_variant:cold-water-immersion/cold-plunge
  -
    type: cites
    target: source_artifact:pmid-39879231
  -
    type: cites
    target: source_artifact:pmid-37866096
measurementContexts:
  - same_day_self_report
  - daily_checkin
unit: score
interpretationFrame:
  principle: Compare the same prompt at the same time window rather than reacting to one especially good or bad session.
  caveat: Work stress, sleep loss, alcohol, illness, expectations, weather, and novelty can all move same-day stress ratings independently of the plunge itself.
biomarker:
  shortName: Stress
  displayName: Perceived Stress
  unit: score
  valuePrecision: 0
  direction:
    desired: lower
    label: Lower is usually better.
    nuance: For cold plunge, timing matters: the most relevant comparison is a stable later-same-day check-in rather than the first minute after cold entry.
  measurement:
    bestContext: Use the same one-tap or 1-to-5 stress rating later the same day after each planned session and on matched non-session days.
    howToMeasure:
      - Use one consistent prompt such as “How stressed or wound up do I feel right now?”
      - Keep the time window stable, ideally later the same day rather than immediately on exit.
      - Compare averages across baseline and intervention windows rather than highlighting one unusually good day.
    confounders:
      - sleep_loss
      - acute_work_stress
      - alcohol
      - illness
      - travel
      - major_caffeine_change
      - expectancy_or_novelty
claims:

  -
    claimId: cold-plunge-perceived-stress-is-best-fit-primary-endpoint
    type: design_guardrail
    text: Perceived stress is the best-fit primary biomarker for Murph’s first cold-plunge protocol because the clearest direct review-level signal is delayed stress improvement rather than a reliable immediate calming effect or a broad physiological marker shift.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-39879231
      - source_artifact:pmid-37866096
    caveats:
      - This is a protocol-design choice based on evidence fit, not proof that every user will notice a stress benefit.
      - The direct literature is still small and mostly healthy-adult.
---

Perceived stress is the most practical primary endpoint for a first-pass cold-plunge self-experiment.

The main reason is timing: the strongest direct synthesis signal is not “instant calm on exit,” but a later reduction in perceived stress or negative affect after some exposures. That makes a simple later-same-day check-in more informative than trying to read the first cold minute as a benefit signal.

For Murph, this biomarker is intentionally simple. A repeatable 1-to-5 or 0-to-10 rating done with the same wording and the same timing window is more useful than a complicated stress questionnaire that the user will not sustain.
