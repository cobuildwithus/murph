---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:sleep-better-in-hot-weather
slug: sleep-better-in-hot-weather
title: Sleep Better in Hot Weather
summary: Cool the person and the room enough for sleep while recognizing when heat becomes a health risk.
status: field-testing
quality: usable
aliases:
  - sleep better during a heat wave
  - stay cool enough to sleep
categories:
  - goals
  - sleep
  - environment
  - heat
goal:
  category: sleep
  parentGoalKey: goal_template:sleep-better
  outcomeKind: function
  goalPhrase: sleep better in hot weather
  successSignals:
    - id: comfortable_sleep_temperature
      kind: symptom
      label: Less heat discomfort at bedtime and overnight
    - id: fewer_heat_awakenings
      kind: symptom
      label: Fewer awakenings caused by heat
    - id: safer_heat_management
      kind: behavior
      label: Safe hydration and cooling during hot conditions
  evidenceSourceKeys:
    - source_artifact:pmid-29073398
    - source_artifact:pmid-34419205
  workflow:
    kind: general_plan
    ownerSkillIds:
      - sleep-improvement
      - sleep-recovery-readiness
  startPrompt: Hey Murph, help me sleep better in hot weather.
  indexable: true
safety:
  cautionLevel: moderate
---

Your body sheds heat as it gets ready for sleep. A hot, humid room makes that harder and can keep you awake. There's no universal bedroom temperature; what helps is air movement, less radiant heat, breathable bedding, and cooling that's safe for you and your climate.

## What to do

- Keep daytime heat out: close blinds or curtains on sun-facing windows and open the home only when outdoor air is cooler.
- Use air conditioning when you have it, especially in dangerous heat. A fan helps sweat evaporate but may not be enough in extreme heat or for high-risk people.
- Cross-ventilate with safely opened windows and fans when outdoor air quality and security allow.
- Use light, breathable bedding and sleepwear, and remove nonessential waterproof or foam layers that trap heat.
- Take a comfortably warm or lukewarm shower before bed to wash off sweat and help heat loss afterward. An ice-cold shower can feel stimulating and isn't needed.
- Drink through the day rather than a lot at bedtime, and replace fluids and electrolytes appropriately after heavy sweating.
- Cut late alcohol and very heavy meals; both can worsen sleep and heat discomfort.

## A simple plan

Before sunset, block the sun and set up the coolest safe sleeping room. Aim a fan across the room, not so hard that it dries your eyes. Lay out a second light sheet, cool water, and a way to change damp clothes in dim light.

For one week, note room temperature if available, heat discomfort from 0 to 10, and heat-related awakenings. Change one thing at a time: earlier blind closure, lighter bedding, a pre-bed shower, or a temporary move to a lower or shaded room.

During a heat wave, put safety ahead of routine. An evening in a cooled public building, a friend's or relative's air-conditioned home, or a designated cooling center may be the best option. Check on people who may not notice or be able to say they're overheating, and plan cooling before the hottest evening hours.

## How to know it is working

You're comfortable enough to fall asleep, wake less from heat or sweat, and function better the next day. The exact thermostat number matters less than humidity, bedding, air movement, age, medications, and preference.

Don't read a higher overnight heart rate during extreme heat as poor recovery alone; heat, dehydration, illness, and the device itself can affect the signal, so go by the environment and your symptoms.

## If you get stuck

If the room stays hotter than outdoors, improve exhaust and cross-ventilation when safe. If humidity is high, air conditioning or dehumidification may beat another fan. If the mattress holds heat, a breathable pad or different sleep surface may beat cooling the pillow.

Have a clinician or pharmacist review medicines and conditions that affect heat tolerance. Older adults, infants, pregnant people, outdoor workers, and people with cardiovascular, kidney, or psychiatric conditions can be more vulnerable.

## A quick note

Confusion, fainting, severe weakness, vomiting, hot dry skin, or worsening headache can signal heat illness. Move to cooling and get urgent help. Do not rely on fans alone when indoor heat is extreme.

## Sources

- [CDC: protecting yourself from extreme heat](https://www.cdc.gov/extreme-heat/prevention/index.html)
- [NHLBI: healthy sleep environment](https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits)
