---
name: sleep-improvement
description: Use for sleep facts and sleep problems, body-clock timing (jet lag, shift work, a late or early schedule, melatonin timing), the call to train, go easier or rest today, HRV and resting heart rate, and tiredness that persists.
---

# Sleep, body clock, readiness and tiredness

This skill covers five connected jobs: reporting and improving sleep, shifting the body clock, deciding whether to train today, reading HRV and resting heart rate, and working out why someone is tired. Read the member's message, the conversation, and their saved and wearable data before you recommend anything. Answer first. Ask one question at the end only when the answer would change the safety advice or the recommendation, and never ask for something the data already shows.

The numbers in this file are Murph's starting defaults. When the Health Commons result for the member's question gives a different figure, use the Commons figure.

## Safety that comes before coaching

Handle these before any habit or training advice.

- If the member cannot reliably stay awake, tell them to stop driving, operating machinery, swimming alone, working at height or doing anything else hazardous, and to get somewhere safe. Caffeine, cold air, music and willpower do not make it safe to continue.
- Chest pain, fainting, severe or unusual breathlessness, new confusion or another new neurological symptom, a rapidly worsening illness, thoughts of self-harm, or being unable to stay safe need urgent or emergency care now.

These patterns need a clinician while you keep helping:

- Loud snoring, gasping or pauses in breathing that someone has seen, morning headaches, unrefreshing sleep despite enough time in bed, or dozing during the day point to a breathing-related sleep disorder. Sudden sleep attacks, or muscles giving way with strong emotion, point to narcolepsy. A wearable and a good sleep score cannot rule either out. Say what the pattern suggests and that a sleep evaluation fits.
- Needing far less sleep while feeling unusually energetic, driven or irritable can be mania. Suggest prompt contact with their clinician, and leave light and schedule changes to that clinician.
- Palpitations with symptoms, a very high resting heart rate, an irregular heartbeat, or a fast heart rate that persists without explanation need a clinician. A normal wearable score never outweighs a symptom.

## Sleep facts and recaps

For "how did I sleep" or a nightly recap, use `murph.attach_sleep_card`. Its tool description says what to send with the card.

For a question about several nights, make one date-bounded read:

```
vault-cli wearables sleep pattern --from <date> --to <date> --format json
```

You can narrow it with `--date`, a repeatable `--provider`, or `--window-days` (default 28, maximum 366). Pass `--time-zone <IANA zone>` only as a reporting fallback for nights that have no saved time zone. Then read the returned `summary.notes` and follow them:

- Describe the pattern across the nights that are present, for example "across 11 nights". A missing date means no data for that night. It does not mean the member did not sleep.
- Leave out dates the notes identify as naps only.
- Leave older nights whose sleep type is unknown unlabeled. Do not guess from their titles.
- Before you call something a shift, check whether a change of provider, travel, daylight saving or a change of time zone explains it.
- Leave out clock times when a night has no validated time zone.
- Report the provider's awake minutes as time awake. Do not call them wake after sleep onset or a count of awakenings.

A recap request is answered by that read. Give the facts and the uncertainty and stop. Read individual nights with `vault-cli wearables sleep list` only for a detail the member asked for that the pattern lacks.

## Improving sleep

Before choosing a change, read the member's active sleep plan (`vault-cli regimen list --kind habit --status active --format json`), 7 to 14 nights of the sleep pattern, and what they say about falling asleep, waking and how they function the next day. The short sleep summary in your prompt context only points at the records. Read the records themselves when they could change the decision.

Work out which problem this is: getting to bed, falling asleep once in bed, waking in the night, waking too early, too little time in bed, or a low wearable score while feeling fine. Ask which one only if the message and the data cannot tell you. Then choose one change for one outcome.

- Too little time in bed: build a realistic sleep window before anything else.
- Getting to bed: treat the move to bed as the behavior to change. Pick a real stopping cue and a tiny first step, such as putting the phone on its charger, and design around the activity that keeps winning. Someone who sleeps readily once in bed does not need sleep-hygiene advice.
- Falling asleep: a wind-down, tomorrow's tasks written down, and leaving bed for a short while when awake and frustrated. Hold a stable wake time before trying an earlier bedtime.
- Waking in the night: look for alcohol, heat, stress, pain, night urination, reflux, a partner's snoring, late meals and clock checking before suggesting any device.
- A low score while feeling fine: recommend no change.

Sleep disturbed by pain, reflux, night urination, pregnancy, a new baby or a medicine still gets practical help here. Leave the medicine itself to the prescriber.

Four rules that differ from common advice:

- Never calculate or run a sleep-restriction schedule or any plan that shortens time in bed. That is a clinical treatment that needs screening and monitoring. A later bedtime or a moved schedule that keeps the same time in bed is fine.
- When insomnia has lasted months or impairs the day, name cognitive behavioral therapy for insomnia (CBT-I) as the treatment that works: from a clinician, or from an evidence-based digital program when access is limited. Do not present sleep hygiene, a supplement or a habit plan as a replacement for it. Keep helping with the practical steps above.
- Never start deep-sleep or REM coaching, a multi-day plan or a supplement change from a wearable's stage estimate alone, and do not compare the member's stage minutes with a population target. Timing and total sleep are more reliable than stage estimates. Treat a stage trend as real only with at least 7 nights on the same device and firmware, good wear, and symptoms that match.
- For a sleep aid, this skill decides what the sleep problem is. Also read `micronutrients-supplements` for magnesium, glycine or herbal products, and `substance-load` for caffeine, nicotine, alcohol, cannabis, antihistamines or sedating medicines. Melatonin is covered below.

When cycle or perimenopause symptoms are driving the sleep problem, also read `cycle-hormonal-health`.

## Body clock

Use this for a late or early schedule, jet lag, shift work and light timing. Read 14 to 30 nights of the sleep pattern first. Irregular wake times can look like a late body clock, so check how much wake time varies before calling the schedule late.

- Decide the direction before giving any light advice: earlier, later, or steadier with no shift. Morning light is the tool for moving earlier only.
- To move earlier: outdoor light soon after waking (10 to 30 minutes to start, longer on dim days) and dimmer light for the 1 to 2 hours before the target bedtime.
- To move later: shift wake time, activity and light later, and avoid bright light very early in the day.
- Move in steps of 15 to 30 minutes a day unless travel forces a faster plan. Keep wake time within a 30 to 60 minute band.
- Before recommending a light box, a fixed bright-light dose or bright light in the evening, check for eye disease or a recent eye procedure, migraine triggered by light, medicines that increase light sensitivity, and bipolar disorder or strong mood symptoms. Bright light at the wrong time can trigger mania, so a member with bipolar disorder should set light timing with their clinician. Ordinary outdoor light with normal eye protection is the default. Never tell anyone to look at the sun or an intense lamp.
- A sleep window that moves later every day, or wraps around the clock, may be a circadian rhythm disorder. Recommend an evaluation and do not set up a fixed-wake plan for it.
- For night shifts, staying awake on the commute and getting enough total sleep matter more than perfect alignment.
- For jet lag, decide whether to shift before travel from the trip's length, its direction and the first important event. Give exact local times.

Melatonin is a timing signal for the body clock. It is a weak sedative, and at the wrong time it moves the clock the wrong way. Discuss it only after the direction is known. Before suggesting a trial, check age, pregnancy or breastfeeding, bipolar disorder, seizures, blood thinners or bleeding problems, sedatives or alcohol, other medicines and supplements, and how the member responded before. If any of these is uncertain, make it a question for their pharmacist or clinician. For a low-risk adult who wants to try it, keep the trial short, with a clearly labeled product, an exact time, and a rule to stop if they feel impaired the next day. Read `micronutrients-supplements` for product, dose and interactions. Do not use melatonin to cover snoring with gasping, dangerous sleepiness or long-standing insomnia.

A pregnant member, or a parent asking about a child, still gets schedule, light and routine help. Melatonin and medicine questions for them go to their clinician or pharmacist.

## Train, go easier or rest today

Read recent recovery and load before answering: `vault-cli wearables recovery list --from <date> --to <date> --format json`, and `vault-cli wearables activity list --from <date> --to <date> --include-workout-summaries --format json` for recent sessions. Then make one of four calls.

- Train as planned: the member functions normally and any deviation is small.
- Train with a ceiling: do the session with a stated limit, such as no maximal lifts, no sets to failure, simpler skills, less heat, or a point at which to stop early.
- Go easy: keep the routine and remove the part of the session that costs the most.
- Rest: function is impaired, symptoms or sleepiness make the session unsafe, the warm-up feels clearly wrong, or the session is worth little compared with its risk.

One short or broken night adds uncertainty and does not cancel a session by itself. When the member is otherwise well, suggest a warm-up check: do the normal warm-up, keep the first real effort clearly below maximum, compare effort, output and coordination with normal, then continue, cap the session, switch to easy, or stop. A warm-up cannot detect every lapse in attention. It does not clear the member to drive, use machinery, swim in open water, work at height, train in traffic or heat, play contact sport, or attempt a maximal lift.

A wearable score informs the call and never decides it. A good score does not outweigh symptoms or poor function. A poor score alone does not require rest. Compare the member with their own usual range on the same device, and check wear time, fit, missing data and device or firmware changes before reacting. Low motivation alone is weak evidence. It counts for more when it persists alongside poor sleep, irritability, unusually high effort or falling performance.

When fatigue has built up over several sessions, a hard block, travel or a stressful stretch, also read `training` to change the program. Reduce the main source of load by the smallest amount likely to restore a normal response, remove maximal and failure work, name what would show recovery, and add no make-up sessions. If the member does not recover after a reasonable reduction, consider illness, injury, eating too little, medicines or substances, mood and a sleep disorder.

Read `physical-therapy` when the reason is new or changed pain, an injury, weakness or numbness. When the member has a flare plan or gets worse after exertion from a long-term illness, follow `chronic-illness-support`. Never replace a flare or pacing plan with athletic recovery advice.

## HRV and resting heart rate

Read the trend before interpreting a single value: `vault-cli wearables metric trend hrv --window-days 28 --format json` and the same command with `restingHeartRate`.

- Compare the member only with their own baseline on the same device. HRV values do not compare across people, devices or measurement methods, and a higher value is not always better.
- A trend over several days matters more than one low night. A drop in HRV of 20 to 30 percent from baseline that lasts several days, or a resting heart rate that stays roughly 5 to 10 beats per minute above baseline with symptoms, is meaningful. Low HRV together with a raised resting heart rate is stronger evidence than either alone.
- For a sudden dip, look in the records for illness, alcohol, short sleep, heat, dehydration and hard training before asking the member.
- When the pattern suggests too much training, reduce intensity for 2 to 4 days and watch for symptoms easing and the numbers returning toward baseline.
- Give a time to look again: tomorrow after a hard session, 3 to 7 days for illness, weeks to months for a fitness change.

## Tiredness that persists

Work out which kind of tired this is: sleepy enough to nap, physically heavy, foggy, or low on drive. Ask which one only if the message and the data cannot tell you. Read 14 to 30 days of context with `vault-cli wearables drift --window-days 28 --format json`, plus training load, food logs, cycle phase, illness, alcohol, caffeine and travel where they are saved. Then give one low-risk change and a date to reassess.

- Clear sleep debt: 3 to 7 nights of a longer sleep window with a stable wake time, before any supplement.
- Eating too little is plausible: add a meal with protein and carbohydrate around the most depleted part of the day and reassess in 3 to 4 days.
- Training load jumped: reduce intensity for 2 to 4 days.
- Signs of illness (raised resting heart rate, lower HRV, faster breathing rate, less activity, worse sleep): rest, fluids and no hard training until the numbers and symptoms settle.
- Caffeine is covering the problem: hold the dose and the cutoff time steady. Do not add more. Read `substance-load`.

Tiredness that has lasted weeks with no clear driver, or that comes with weight loss, fevers or night sweats, breathlessness on exertion, low mood, pregnancy or a new medicine, deserves a clinician visit and basic blood tests. Say so plainly, help the member prepare for it, and keep helping with sleep, food and training load in the meantime. Normal wearable data does not rule out anemia, thyroid disease, depression, a medicine's side effect, sleep apnea or a post-viral illness. If exertion makes the member worse for a day or more afterward, do not advise pushing through. Read `chronic-illness-support`. For questions about a specific lab result, read `cardiometabolic-health` or `micronutrients-supplements`.

## Saving an accepted plan

When the member accepts a repeated sleep, schedule or recovery plan, read `behavior-followthrough` and save it as one active habit regimen (`vault-cli regimen save "<title>" --kind habit`). Update a matching plan instead of creating a second one. Offer one review at the point when the outcome could have changed, timed for when it can be observed. For example, ask in the morning how rested they feel. Create a reminder or a recurring check-in only after the member says yes to that specific offer.

If the member wants to test whether a change works, or to compare two options, read `experiment-onboarding` and set it up as an experiment.

## Answer shape

- Sleep coaching: name the kind of sleep problem, then one change, one window for measuring it, and the wearable signal that would show it is working. A factual recap gives the facts and the uncertainty and does not invent a problem to solve.
- Train or rest: give the call, the one to three facts behind it, the exact limit or action, and what would change the call.
- HRV, resting heart rate and tiredness: start with how the member compares with their own baseline and the most likely driver, then the one change and when to look again.
