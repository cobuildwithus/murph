---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:mood-affect
slug: biomarkers/mood-affect
title: Mood / Affect
summary: A same-day mood rating that is worth tracking for cold plunge, but should be interpreted as timing-sensitive and mixed rather than guaranteed to improve immediately.
status: draft
quality: usable
aliases:
  - mood rating
  - affect
  - positive affect
  - negative affect
categories:
  - mood
  - self-report
  - manual-checkin
relations:

  -
    type: related_protocol
    target: protocol_variant:cold-water-immersion/cold-plunge
  -
    type: cites
    target: source_artifact:doi-10.1002-lim2.53
  -
    type: cites
    target: source_artifact:pmid-36829490
  -
    type: cites
    target: source_artifact:pmid-37866096
  -
    type: cites
    target: source_artifact:pmid-39879231
measurementContexts:
  - same_day_self_report
unit: score
interpretationFrame:
  principle: Use the same mood prompt and timing window across baseline and intervention days.
  caveat: Exercise, social context, novelty, music, caffeine, weather, and sleep can all shift mood independently of the plunge.
biomarker:
  shortName: Mood
  displayName: Mood / Affect
  unit: score
  valuePrecision: 0
  direction:
    desired: higher
    label: Higher or more positive is usually better.
    nuance: Cold-plunge mood signals are mixed by timing. Some studies show an immediate lift, while others show a delayed or selective change instead.
  measurement:
    bestContext: Use a simple same-day mood or positive/negative affect rating after planned sessions and on matched non-session days.
    howToMeasure:
      - Pick one simple question such as “How good do I feel right now?” or separate positive and negative affect ratings.
      - Keep the assessment timing consistent across days.
      - Interpret mood trends with context rather than assuming every plunge should feel good immediately.
    confounders:
      - exercise
      - social_context
      - sleep_loss
      - caffeine
      - alcohol
      - weather
      - expectancy_or_novelty
claims:

  -
    claimId: cold-plunge-mood-is-timing-sensitive
    type: mixed_evidence
    text: Mood or affect is a reasonable secondary endpoint for cold plunge, but the direct evidence is timing-sensitive: some studies show immediate improvement, while others support a later reduction in negative affect or perceived stress instead.
    strength: moderate
    sourceKeys:
      - source_artifact:doi-10.1002-lim2.53
      - source_artifact:pmid-36829490
      - source_artifact:pmid-37866096
      - source_artifact:pmid-39879231
    caveats:
      - Most positive studies are small and healthy-adult.
      - Differences in water temperature, setting, and rating time can change the observed signal.
---

Mood is worth logging for cold plunge because several direct studies do suggest that some people feel better after exposure.

But the pattern is not consistent enough to promise “instant mood boost” as the default story. A mild 20 °C 5-minute immersion and an outdoor immersion study both support near-term affect improvement, while a colder 10 °C lab immersion pointed more toward delayed reduction in negative affect and cortisol.

That is why mood is best treated as a useful secondary biomarker: track it, but interpret it with timing, temperature, and context in mind.
