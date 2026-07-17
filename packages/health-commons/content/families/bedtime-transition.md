---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:bedtime-transition
slug: families/bedtime-transition
title: Bedtime Transition
summary: Low-burden routines for crossing from the last evening activity into a sleep attempt when the problem is getting to bed, not an inability to sleep once there.
status: field-testing
quality: usable
aliases:
  - bedtime procrastination transition
  - getting to bed routine
  - bedtime shutdown routine
  - stop doing things and go to bed
categories:
  - sleep
  - bedtime-procrastination
  - behavior-change
  - evening-routine
familyKind: intervention
canonicalMechanism: reduce_bedtime_transition_friction
relations:
  - type: related_protocol
    target: protocol_variant:bedtime-transition/standard-tiny-fallback-transition
  - type: primary_biomarker
    target: biomarker:bedtime-delay
  - type: secondary_biomarker
    target: biomarker:sleep-onset-latency
  - type: secondary_biomarker
    target: biomarker:sleep-quality
  - type: secondary_biomarker
    target: biomarker:daytime-sleepiness
  - type: cites
    target: source_artifact:pmid-37354745
  - type: cites
    target: source_artifact:pmid-24997168
---

Bedtime Transition covers the gap between **wanting to stop** and **actually beginning a sleep attempt**. It is for voluntary bedtime delay without a current external reason, not for shift work, on-call duties, caregiving, pain, breathing symptoms, circadian disorders, or an inability to sleep after getting into bed.

The family keeps the behavior small: one cue and one prechosen transition with a standard, tiny, and fallback version. It does not prescribe sleep restriction, an exact universal bedtime, a full sleep-hygiene stack, or a punitive app lock.

The direct question is whether a lighter transition reduces the delay between the prospectively intended and actual sleep attempt. Sleep-onset latency, sleep quality, and daytime function then show whether improving that behavior helps rather than merely moving the clock.
