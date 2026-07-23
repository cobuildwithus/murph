---
name: daily-activity
description: Use for steps NEAT sedentary time activity snacks walking breaks and daily movement pattern interpretation.
---

# Daily Activity

Use this as Murph operating guidance, not as a consumer article. Ground the answer in the current conversation, vault context, and wearable data before recommending. Ask at most one missing question when the answer would materially change the next step.

## Owns

- Steps, NEAT, sedentary time, walking breaks, activity snacks, everyday movement targets, and daily movement trend interpretation.
- Factual wearable day and workout reads, including every workout on a date,
  activity types, workout count, and total workout duration.
- Helping users add movement without turning it into formal training.
- Explaining how small daily movement affects glucose, energy, mood, sleep pressure, and cardiovascular health.

## Hand Off

- Use running-cardio for structured cardio workouts or Zone 2 plans.
- Use strength-training for resistance programming.
- Use physical-therapy for pain, injury, function loss, or return-to-activity constraints.
- Use cardiometabolic-health when the main question is glucose, BP, lipids, or labs.

## Data First

- For any date-specific wearable question, first run
  `vault-cli wearables day <date> --format json`. For "all workouts," activity
  types, session count, total workout time, or more normalized workout detail
  on that date, next run
  `vault-cli wearables activity list --date <date> --format json`.
- Treat those normalized surfaces and their canonical workout-day rollup as
  the answer owner. Do not stop at one selected activity in a general daily
  summary, and do not manually deduplicate or sum provider records.
- Use
  `vault-cli event list --kind activity_session --from <date> --to <date> --format json`
  only as last-resort diagnostics when the normalized surfaces materially
  disagree or the user explicitly asks for raw evidence. Raw records never
  become a model-owned reducer or deduplication path.
- Check steps, sedentary time, active minutes, workout days, work schedule, commute, sleep, fatigue, and pain flags.
- Use the user's baseline; a 2,000-step jump can be easy for one user and too much for another.
- Look for long unbroken sitting blocks, not just daily step total.

## If Context Is Thin

Ask: "Do you want more total steps, fewer long sitting blocks, or a simple movement target that will not feel like a workout?"

## Practical Levers

- Increase steps gradually, often by 1,000-2,000 per day above baseline before chasing a universal 10,000-step target.
- Break long sitting with 2-5 minute movement snacks, especially after meals or long desk blocks.
- Post-meal walks can help glucose and digestion without requiring a workout.
- Use environment design: walking calls, farther parking, stairs, default short loop, or calendar anchors.

## Interpretation Rules

- Step count misses cycling, lifting, swimming, carrying, and intensity; do not overvalue it alone.
- Active minutes algorithms vary by device; use trends rather than cross-device comparisons.
- Daily movement can improve health even when formal workouts stay unchanged.
- Treat changeable totals for the current local calendar day as provisional and
  say "so far." A completed individual workout may still be described as
  completed, but its duration does not make the day's combined count, duration,
  steps, or movement total final.
- Distinct workouts on the same day are additive: add their durations and count
  each session rather than replacing one with another. Mirrored copies of the
  same workout still count once.
- A mismatch between a daily summary and an exact workout record is evidence
  of a read mismatch, not proof that the provider failed to sync or that a
  workout failed to import. State what each surface shows without inventing a
  cause.

## Safety Boundaries

- Escalate pain, swelling, chest pain, fainting, severe breathlessness, or sudden activity intolerance.
- Do not push step targets during acute illness, injury flares, or severe fatigue.

## Answer Shape

- For a factual day or workout request, answer the question directly from the
  normalized result: give the canonical count and total, then list only the
  activity types or session details that result actually exposes. Do not force
  coaching or invent a session label that the normalized surface omits.
- For a coaching request, give one baseline-relative target and one
  friction-reduction tactic. Prefer movement the user can repeat daily over a
  heroic one-day goal, and say how to reassess after 1-2 weeks.
