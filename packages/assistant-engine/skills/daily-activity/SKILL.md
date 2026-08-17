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

- When the user specifically asks for basal calories, go directly to
  `vault-cli measurement entry list --metric calories_basal --from <date> --to <date> --limit 50 --format json`.
  Do not run `wearables day` first; basal calories are query-only and absent
  from that summary.
- For date-specific facts, first run
  `vault-cli wearables day <date> --format json`; for all workouts, types,
  count, duration, or normalized detail, next run
  `vault-cli wearables activity list --date <date> --format json`. Its canonical
  workout-day rollup owns the answer. When available, `workoutFeatures`
  associates bounded heart-rate, cadence, power, speed, and split details with
  each workout by provider and start time. Use that association for multiple
  workouts on the same date; do not stop at one selected activity or rebuild
  the rollup from provider records. Power fields ending in `Watts` are watts,
  and speed fields ending in `Mps` are meters per second; include those units
  when answering.
- When the day or activity summary omits the specific signal the user asked
  about, use the lossless global observation read
  `vault-cli measurement entry list --metric <metric> --from <date> --to <date> --limit 50 --format json`.
  Use the requested date or a short bounded trend window and the matching
  public metric name: `daylight_exposure`, `fall`, `floors_climbed`,
  `handwashing`, `stand_duration`, `stand_hour`, `uv_exposure`,
  `wheelchair_push`, `workout_distance`, `workout_duration`, or
  `workout_swimming_stroke`. These resource aliases belong to the global
  metric index, not the narrower `wearables metric` summary catalog. Use the
  returned source and event ID as provenance; imported device observations may
  be query-only and unavailable through `vault-cli show`. No returned entries
  means missing coverage, not zero or proof the event did not happen.
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
- Treat changeable current-local-day totals as provisional and say "so far."
  A completed workout does not make the day's combined totals final.
- A summary/workout mismatch is a read mismatch, not proof of failed provider
  sync or import. State what each surface shows without inventing a cause.

## Safety Boundaries

- Escalate pain, swelling, chest pain, fainting, severe breathlessness, or sudden activity intolerance.
- Do not push step targets during acute illness, injury flares, or severe fatigue.

## Answer Shape

- For a factual day or workout request, answer the question directly from the
  normalized result: give the canonical count and total, then list only the
  activity types or workout details that result actually exposes. Treat an
  empty `splits` array as no retained split facets for that workout, including
  after a provider correction. Do not force coaching or invent a session label
  that the normalized surface omits.
- For a coaching request, give one baseline-relative target and one
  friction-reduction tactic. Prefer movement the user can repeat daily over a
  heroic one-day goal, and say how to reassess after 1-2 weeks.
