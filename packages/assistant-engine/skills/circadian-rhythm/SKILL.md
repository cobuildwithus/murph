---
name: circadian-rhythm
description: Use for sleep timing body clock light exposure jet lag shift work chronotype and delayed or advanced sleep schedule questions.
---

# Circadian Rhythm

Use this as Murph operating guidance, not as a consumer article. Ground the answer in the current conversation, vault context, and wearable data before recommending. Ask at most one missing question when the answer would materially change the next step.

## Owns

- Body-clock timing, chronotype, delayed or advanced sleep schedule, social jet lag, jet lag, shift-work adaptation, and light/darkness timing.
- Morning and evening light plans, schedule-anchoring, and time-zone transition strategy.
- Explaining why sleep can be adequate in duration but mistimed for the user's obligations.

## Hand Off

- Use sleep-improvement when the main issue is insomnia mechanics at an appropriate clock time.
- Use energy-fatigue when the main issue is persistent fatigue despite adequate sleep timing and duration.
- Use cycle-hormonal-health when menstrual or perimenopause symptoms dominate timing and sleep disruption.
- Route bipolar disorder, severe depression, circadian rhythm disorder treatment, pediatric cases, pregnancy, and medication questions to clinician support.

## Data First

- Check 14-30 days of sleep midpoint, wake time, bedtime, weekday/weekend drift, naps, travel, shift schedule, light exposure if available, workouts, and caffeine timing.
- Read the provider-neutral canonical timing view with `vault-cli wearables sleep pattern --format json` before interpreting a multi-night clock pattern. Narrow it only when useful with `--date`, `--from`/`--to`, repeatable `--provider`, or `--window-days`; use `--time-zone <IANA>` only as an explicit reporting fallback when a night lacks a canonical zone.
- Read `summary.notes` before advising. Missing wearable dates are missing coverage, not proof of no sleep; nap-only dates are excluded when identified; legacy nights with unknown sleep identity stay unknown; mixed providers, device latency, stale sync, duplicate/overlapping episodes, travel, DST, or mixed time zones can create apparent shifts; omit clock-time conclusions when no validated zone exists.
- Use the user's required wake time and real constraints before prescribing morning light or bedtime changes.
- Look for variability first; irregular wake times can masquerade as delayed sleep phase.
- Distinguish a stable late phase from a sleep window that progressively drifts later day after day or wraps around the clock. Do not force a fixed-wake self-experiment for progressive free-running drift; route possible non-24-hour or another circadian rhythm disorder for clinical evaluation.

## If Context Is Thin

Ask: "What wake time do you need most days, and what time do you naturally fall asleep and wake up when you do not force it?"

## Practical Levers

- Determine the desired shift direction before giving light advice: earlier (phase advance), later (phase delay), or stability without a shift. Do not default to morning light merely because the current schedule is inconvenient.
- Anchor wake time within a consistent 30-60 minute band when possible.
- For an earlier shift, morning outdoor light soon after waking is the default phase-advance lever; 10-30 minutes outdoors is a practical starting point, longer in dim weather.
- Dim evening light and reduce bright overhead/screens in the 1-2 hours before target bedtime when shifting earlier.
- For a later shift, move wake/activity/light anchors later gradually and avoid unintentionally reinforcing the old early phase with very-early bright light. Do not prescribe rigid evening bright-light exposure until current timing, eye/mood safety, and the required later schedule are clear.
- Move schedules gradually, often 15-30 minutes per day, unless travel constraints require a short tactical plan.
- Use naps carefully: short and early when needed; late or long naps can delay the clock.
- For jet lag, decide whether to shift before travel based on trip length, direction, and first important event.

## Melatonin As A Clock Signal

- Use this lane only after identifying whether the user is trying to shift earlier, shift later, or stabilize. Melatonin is a timing signal, not a universal sedative; the wrong timing can move the clock in the wrong direction or cause next-day impairment.
- Sleep-improvement still owns the sleep phenotype, and micronutrients-supplements owns product, label, interaction, and total-regimen safety. Do not use melatonin to paper over loud snoring/gasping, dangerous daytime sleepiness, unexplained awakenings, or persistent impairing insomnia.
- Before suggesting any trial, check age, pregnancy/postpartum, bipolar/mania risk, seizure history, bleeding or anticoagulant concerns, sedatives/alcohol, other medicines or supplements, prior response, formulation, and local prescription status. Route uncertainty to a clinician or pharmacist.
- Do not assume more is better, infer a precise dose from a gummy or tablet name, or recommend indefinite high-dose use. If a low-risk adult still wants to try it, keep the plan short and bounded, use a clearly labeled reliable product, define the exact timing goal and next-day stop rule, and review whether timing and function actually improved.

## Interpretation Rules

- Sleep midpoint is often more useful than bedtime alone.
- Wearable sleep stages do not diagnose circadian phase; use timing regularity, sleepiness pattern, and light exposure context.
- A later chronotype is not laziness; the goal is fit between biology and obligations.

## Safety Boundaries

- Bright-light timing can worsen mania or agitation in vulnerable users; route bipolar-spectrum or severe mood symptoms to clinician support.
- Before prescribing a rigid bright-light dose or a light box, check eye disease or recent eye procedures, photosensitivity, migraine/light-trigger history, and medications or supplements that increase photosensitivity. Prefer ordinary outdoor light with normal eye protection when appropriate; never tell the user to stare at the sun or an intense lamp. Route uncertain eye, medication, or mood risk to a clinician or pharmacist.
- Night-shift plans should prioritize safety, commute sleepiness, and enough total sleep over perfect circadian alignment.

## Accepted Schedule Shift

When the user accepts a multi-day schedule shift, use sleep-improvement for the sleep outcome and behavior-followthrough for the canonical habit regimen, bounded review, and separately consented support. Use experiment-onboarding instead when the user is testing or comparing schedules rather than simply implementing the chosen one.

## Answer Shape

- State whether the problem looks like a timing problem, an opportunity problem, or insomnia layered on timing.
- Give one light anchor and one darkness/schedule anchor.
- Use exact local times when discussing travel or shift work.
