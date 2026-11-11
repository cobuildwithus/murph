---
name: daily-activity
description: Use for steps, everyday movement, sitting time and walking breaks, and for factual questions about a day's wearable activity or workouts (which workouts, how long, how far, splits).
---

# Daily activity

This skill answers factual questions about a day's activity and workouts, and helps a member move more in ordinary life without formal training. Answer from the data first. Ask one question at the end only when the answer would change the recommendation.

Read `training` for structured cardio or strength plans, `physical-therapy` when pain or an injury limits movement, and `cardiometabolic-health` when the real question is glucose, blood pressure or lipids.

## Reading a day's activity or workouts

Decide what the question needs before the first read, then make one activity read at that level. Do not start with a smaller read and retry, and do not run `wearables day` first for a workout question.

| The question needs | Read |
|---|---|
| Day totals: how many sessions, total minutes, which activity types | `vault-cli wearables activity list --date <date> --format json` |
| Individual workouts: selecting, comparing, ordering or attributing them | the same command with `--include-workout-summaries` |
| Lap or split rows | the same command with `--include-workout-details` |
| Another fact about a specific date | `vault-cli wearables day <date> --format json` |
| Basal calories | `vault-cli measurement entry list --metric calories_basal --from <date> --to <date> --limit 50 --format json` |

Workout summaries keep each workout's type, duration, distance, start time, provider, heart rate, cadence, power and speed. `splitsOmitted: true` means the splits were left out of that read. It does not mean the workout had none. With workout details, an empty `splits` array means no split rows were kept for that workout.

The workout-day rollup in the result is the answer for counts and totals. Use `workoutFeatures`, which matches detail to each workout by provider and start time, when a date has several workouts. Answer about all of them, and do not rebuild totals from provider records. Fields ending in `Watts` are watts and fields ending in `Mps` are meters per second. Say the unit.

When the day or activity summary lacks the signal the member asked about, read it from the measurement index:

```
vault-cli measurement entry list --metric <metric> --from <date> --to <date> --limit 50 --format json
```

The metric names are `daylight_exposure`, `fall`, `floors_climbed`, `handwashing`, `stand_duration`, `stand_hour`, `uv_exposure`, `wheelchair_push`, `workout_distance`, `workout_duration` and `workout_swimming_stroke`. These names work only with this command. `wearables metric` does not know them. Cite the returned source. When nothing comes back, say none was recorded for that date. Never report a zero.

Totals for the current local day can still change, so say "so far". A finished workout does not make the day's totals final. When the day summary and the workout list disagree, report what each shows and do not invent a cause such as a failed sync.

For a factual request, give the count and total, then only the activity types or workout details the result contains. Do not add coaching or a session label the result does not have.

## Helping someone move more

For a simple walking plan, use what the member said about their current activity, their free time and the duration they chose, plus saved context. Do not collect step counts, labs or body measurements unless a symptom, a known condition or the target they asked for makes them matter. Missing wearable data is no reason to read more or to set a step target.

- Set the target from the member's own baseline. A starting step is 1,000 to 2,000 more steps a day than they do now. Do not open with 10,000.
- Break up long sitting with 2 to 5 minutes of movement, especially after meals and long desk stretches. Look for long unbroken sitting as well as the daily total.
- Make it easy to repeat: walking calls, a default short loop, stairs, a calendar anchor.
- Step counts miss cycling, lifting, swimming and carrying, and devices count active minutes differently. Read trends on one device.
- Do not push a step target during an acute illness, an injury flare or severe fatigue.

Give one target relative to their baseline and one way to make it easier, and say you will look again in 1 to 2 weeks.

Chest pain, fainting, severe breathlessness, or a sudden drop in what the member can do needs medical attention before any activity plan. Say so first.
