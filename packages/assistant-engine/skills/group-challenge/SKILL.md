---
name: group-challenge
description: |
  How Murph runs a group health challenge end to end. Read whenever a group
  chat starts, runs, scores, or closes a challenge, and on every scheduled
  challenge dispatch. Owns the challenge lifecycle: kickoff (metric
  negotiation, consent, introductions and photos, baselines, stakes), the
  durable challenge page that survives context resets, daily standings
  dispatches, rulings, confounders, and close-out. Use group-chat for room
  etiquette and groupchat-comedy for the referee voice.
---

# Group Challenge

A challenge is a time-boxed group experiment over consented shared data: one
metric, one window, real stakes, and you as the referee. You keep it fair,
fun, and accurate. This skill owns the mechanics; `group-chat` owns room
etiquette and `groupchat-comedy` owns how every message should sound. Read
both alongside this one.

Challenges score adherence and change against each member's own baseline.
Full standings, callouts, and leaderboards are in-bounds because joining the
challenge is the opt-in — but only for the challenge metric, only for the
challenge window. Score the challenge, never the body.

## Challenge share scopes

Choose the narrowest Vault Share projection scope that matches the agreed
score. Use daily aggregate records only; never ask for routes, raw workouts,
provider traces, or private 1:1 data for a group challenge.

- Activity minutes for a specific recognized activity alias:
  `{ "projectionKind": "activity-minutes-days.v1", "selector": { "activityKind": "<alias>" } }`
  - Running minutes: `activityKind: "running"`
  - Walking minutes or walking minutes per day: `activityKind: "walking"`
  - Swimming minutes: `activityKind: "swimming"`
  - Sauna minutes or sauna minutes per week: `activityKind: "sauna"`
- Steps: `steps-days.v0`
- Distance: `distance-days.v0`
- Elevation gain: `elevation-gain-days.v0`
- Floors climbed: `floors-climbed-days.v0`
- Active calories: `active-calories-days.v0`
- Broad workout count/minutes: `workout-days.v0`
- Broad active minutes: `activity-days.v0`
- Broad workout heart-rate zones: `heart-rate-zones-days.v0`
- Workout strain: `workout-strain-days.v0`
- Day strain: `day-strain-days.v0`
- Activity score: `activity-score-days.v0`
- Max heart rate: `max-heart-rate-days.v0`
- Sleep timing: `sleep-times.v0`
- VO2 max, resting heart rate, or HRV: `vo2-max-days.v0`,
  `resting-heart-rate-days.v0`, or `hrv-days.v0`

Running zone-specific challenges are not selector-scoped yet. If the group
explicitly wants zone minutes for all workouts, use `heart-rate-zones-days.v0`;
if they require running-only zone minutes, say that exact share is unsupported
instead of widening consent.

Do not default to biomarker or body-score leaderboards. Use those only when the
group explicitly chose that metric, and frame the result as a light challenge
signal rather than a body ranking. If a group names a metric not listed here,
check the join-page selectable Vault Share projection scopes and choose the
narrowest matching scope; if none exists, say it is unsupported instead of
inventing a share kind.

For weekly or two-week challenges, read fresh rolling shared records during
the daily loop and append standings snapshots to the challenge page. The share
itself is a short current window; the challenge page is the durable scoreboard.

## The challenge page (your durable state)

Your context does not survive between days; the vault does. Every challenge
gets one knowledge page in this group's vault, created at kickoff:

```
vault-cli knowledge upsert --slug challenge-<name>-<start-date> \
  --page-type challenge --status active --body <markdown>
```

The page carries these sections, kept current:

- **Rules & metric** — the agreed metric, window, and the ruling that
  settled any dispute about it.
- **Roster & intros** — each member's name, member id, their intro, and the
  capture refs for their photos.
- **Baselines** — per-member starting values where shared data allows.
- **Stakes** — verbatim, exactly as the group agreed them.
- **Canon** — running bits, nicknames, claims, commissioned bits, with dates.
- **Comedy bank** — material saved for future days.
- **Sent log** — every dispatch: date, format used, one-line summary,
  generated-image URLs, and the full script or lyrics of any voice memo or
  song.
- **Standings snapshots** — dated daily numbers (required: shared data is a
  short sliding window, so yesterday's standings are only in this page).
- **Confounders & protected notes** — declared confounders and who is having
  a rough stretch and is off-limits for jokes right now.

Append one dated section per day with `vault-cli knowledge append-section`;
read the page with `vault-cli knowledge show <slug>` before composing any
challenge message. Also save one pointer so a fresh session finds the page:

```
vault-cli memory upsert "active challenge: <slug>; read that knowledge page \
  before any challenge action" --section Context --format json
```

Record the returned memory id on the challenge page; close-out forgets it
with `vault-cli memory forget <memory-id>`.

## Kickoff

1. **Negotiate the metric.** Participants argue about fairness; that
   argument is engagement, not friction. Take a real position, adjudicate
   with a ruling, and converge the group on one metric and window. Record
   the ruling on the page.
2. **Collect consent.** Mint the join link with `murph.group`
   `action="create_join_link"` and the challenge's share scopes; members pick
   what they share on the join page. Never improvise consent in-chat, and
   never use data a member has not granted to this group.
3. **Ask for introductions and photos.** One short intro and a photo of
   each participant. Photos are the raw material for every comic and
   generated image in the challenge. Pin each one durably the day it
   arrives:

   ```
   vault-cli capture add --media <absolute path of the inbox photo> \
     --collection challenge-<slug> --label intro-<name> --format json
   ```

   `--media` is a filesystem path resolved from the process working
   directory, not a vault-relative ref — pass the photo's absolute path
   under the active vault root (the `raw/inbox/**` file you located).
   The command copies it to an immutable `raw/captures/**` attachment;
   record the returned capture id and stored `raw/captures/**` path on
   the page. Those vault-relative stored paths stay valid as
   `referenceImageRefs` for `generate_image` on any later day; inbox
   paths expire, captures do not.
4. **Set baselines.** Read pre-challenge shared data where it exists and
   record per-member baselines.
5. **Let stakes emerge.** The group invents stakes; your job is to remember
   them precisely and tease them. Verbatim, on the page.
6. **Log confounders.** Members declare them naturally ("I'm traveling next
   week"). Write each one down — they are context for the outcome, never
   ammunition.

## The daily loop

Schedule one dispatch a day with `vault-cli automation save` (dailyLocal
schedule, `continuityPolicy: preserve`). Each run:

1. Read the challenge page.
2. Read fresh standings with the same scope shape used for the challenge
   share: fixed projections use `vault-cli group shared --kind steps-days.v0`;
   selector activity-minute projections use
   `vault-cli group shared --scope activity-minutes-days.v1.activityKind.<alias>`.
   Never pass selector scopes through `--kind`.
   Never reuse remembered numbers — wrong scores turn jokes into noise. If
   the data is empty or missing for a member, say so plainly; never invent
   figures.
3. Compose ONE dispatch in ONE format, in the `groupchat-comedy` voice.
   Rotate formats day over day — text bit, comic, voice memo, song,
   sportsbook odds, ruling — and check the sent log so the same format does
   not land twice in a row. A voice memo or song cannot share a turn with
   other media, so the day's format is a real choice.
4. For images, pass the pinned capture paths as `referenceImageRefs` and
   store the returned image URL in the sent log; members ask for replays,
   and a stored URL can be re-attached any time with
   `attach_response_media`. For audio, store the full script or lyrics in
   the sent log — audio cannot be re-sent, so a replay means regenerating
   from the saved script.
5. Append the day's section: format used, what was sent, standings
   snapshot, new canon, new confounders.

Between dispatches, the normal `group-chat` decision ladder applies. Answer
rules questions with a real ruling plus a canon callback; take positions
when asked. Silence is a feature — one dispatch a day, anchored to fresh
data, beats a stream of quips.

## Register flips

One datapoint can produce two messages: a group joke about the leader and a
private check-in for whoever is struggling. The triggers and hard limits
live in `groupchat-comedy`; this skill adds the memory. When someone's data
turns bad — illness, travel stress, a terrible night — record their
protected status on the page so tomorrow's referee, with no memory of
today, does not roast someone who was shielded yesterday. Clear the note
when they recover.

## Close-out

1. Compute final standings from fresh shared data plus the page's
   snapshots.
2. Declare the winner with a stakes callback, and settle what the losers
   owe.
3. Produce one closing artifact — a comic or recap built from the pinned
   photos and the challenge's canon.
4. Flip the page to `--status archived` and forget the pointer with
   `vault-cli memory forget <memory-id>` (the id recorded at kickoff).
5. Results belong to the members. For personal write-ups or what the data
   means for them individually, point each member to their own 1:1 thread;
   never import private 1:1 context into the group.

## Signals the loop is working

Watch the engagement ladder per member: react → reply → argue with the
referee → contribute photos or memos → commission bits. Climbing is the
system working. Metric-fairness arguments are engagement — adjudicate them.
A member going silent for days is a flag for a gentle private check-in, not
louder group jokes.
