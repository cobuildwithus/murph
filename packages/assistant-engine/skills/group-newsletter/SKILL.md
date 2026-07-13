---
name: group-newsletter
description: |
  Write, set up, edit, or send Murph's recurring group health newsletter from
  consented shared stats. Read when a group asks for an email newsletter and
  on every scheduled `group-health-newsletter` run. Owns the weekly editorial
  story, natural presentation of exercise, sleep, steps, and trends,
  the exact group-name subject rule, supportive or explicitly opted-in roast
  tone, and the final shared email. Use group-chat alongside this skill for
  room etiquette, join offers, and opt-out behavior.
---

# Group Newsletter

Write the email that makes the group want to reply. It should feel like a
friend noticed what happened this week, not like a wearable exported a report.
Use the shared numbers generously when they make the story better.

Read `group-chat` alongside this skill during setup or a live group
conversation. This skill owns the newsletter's editorial decisions and final
email; `group-chat` owns room behavior, consent offers, and opt-out handling.

## Set up the scheduled run

Keep the newsletter as the single `group-health-newsletter` cron automation in
the group vault. During setup, follow the questions, consent, schedule, notice,
and first-send rules in `group-chat`.

Save self-contained automation instructions. Future scheduled notification
turns may not have read the setup conversation or `group-chat`. Include:

- that this is the `group-health-newsletter` email automation;
- the exact chosen newsletter name and tone;
- any custom note from the group;
- an instruction to read and follow
  `$MURPH_ASSISTANT_SKILLS_ROOT/group-newsletter/SKILL.md` before composing;
- an instruction that every subject starts with the exact chosen name, never a
  generic label such as "Weekly Group Health Digest."

## Compose each edition

1. Read the current automation so its exact name, tone, and custom note govern
   this edition.
2. Call `murph.newsletter` with `action="prepare"`. This returns recipient
   eligibility and the scheduled `referenceAt`, not health data. If `prepare`
   is unavailable or fails, or `referenceAt` is null, do not compose or call
   `send`; return a `skip` notification decision with a factual private summary
   and stop.
3. Run `vault-cli group weekly --as-of <referenceAt>` with that exact timestamp.
   Use only this consented group result. Do not infer a missing value or fetch
   private 1:1 data. If the command is unavailable or fails, do not compose or
   call `send`; return a `skip` notification decision with a factual private
   summary and stop.
4. Join the two results by exact `memberId`. Build the featured set only from
   weekly members whose prepared participant has `hasEmail === true` and who
   have at least one `weeklyStats` entry whose `currentWeekAvg !== null`. Never
   use or mention any other participant or their stats in the subject, HTML
   body, or text body. Use a current-week leader only when `currentWeekAvg !==
   null`; use a week-over-week comparison only when both `currentWeekAvg` and
   `previousWeekAvg` are non-null.
5. Find the week's story before writing. Prefer a close race, clear leader,
   comeback, surprising combination, broad group shift, or group increase
   versus last week.
6. Choose the facts that develop that story. Usually include 6–12 useful stats,
   but use more or fewer when the week warrants it. Do not give every person
   the same fields merely because they are available.
7. Write the subject, HTML body, and equivalent text body. Then call
   `murph.newsletter` with `action="send"` once.

After any `send` result—including sent, partial failure, no recipients,
unavailable, or failed—do not retry `send` in the same turn. Return the
notification decision `{"kind":"skip","privateSummary":"..."}` with a short
factual private summary. The email tool or runtime owns delivery, retry, and
backoff; never return `send_message`, a digest, an operational error, or a
delivery confirmation that would create a second message on the bound group
channel.

If no participant has `hasEmail === true`, do not send an empty edition. Return
one `send_message` notification decision telling the group that there are no
eligible email recipients yet and pointing them to `/settings?addEmail=true`,
then stop for that run. If participants can receive the email but the featured
set is empty, send a short email without health comparisons. Never mention who
failed to share, who lacks an email, or who had insufficient data.

## Turn stats into a story

Cross-person comparisons are welcome within the featured set. Compare exercise,
movement, steps, sleep duration, sleep timing, consistency, and other consented
group metrics when the comparison is interesting. Also use week-over-week
personal change; a comeback often makes a better story than the absolute lead.

Do not declare anyone the healthiest person or turn one biomarker into a
verdict. For HRV, resting heart rate, weight, symptoms, or similar
context-dependent measures, prefer personal change and group-level patterns
unless the group explicitly chose that metric for a challenge. State
associations and observations without claiming that one metric caused another.

Give numbers jobs. Each number should establish at least one of:

- a leader or close race;
- a personal comeback or increase versus last week;
- a meaningful group trend;
- a surprising contrast;
- context for the week's central joke or observation.

Cut a number that only proves the tool returned it. Never write a census such
as one sentence per member with the same metric template.

## Use human units

Never expose dashboard language such as a raw total of active minutes.

- Render current newsletter exercise and movement durations as daily averages:
  "about 30 minutes of exercise a day."
- For a close race, keep useful precision: "41 minutes a day, only two minutes
  ahead of Luis."
- For sleep, use hours and minutes per night: "8 hours 42 minutes a night."
- Round when extra precision adds nothing. Keep exact minutes when the closeness
  is the point.
- Keep units consistent inside a comparison.
- In `vault-cli group weekly`, the `activity-minutes` stream is built from
  shared workout minutes. Its `currentWeekAvg` is an average per observed day:
  call it exercise and present it as a daily average. The current payload has
  no coverage count or weekly total, so never multiply the average by seven or
  describe it as total weekly exercise.
- Do not use `workout-count` to claim a weekly workout total, rank who completed
  the most workouts, or say someone went from zero workouts to a positive
  count. Its current average covers recorded workout days only and omits zero
  days, so those claims are not supported.
- Do not claim a monthly or four-week high. `vault-cli group weekly` provides
  only current and previous-week averages and their percentage change.
- For other sources, say "exercise" only when the value represents workouts or
  exercise. If the source is broad activity or `activeMinutes`, call it
  "movement" and still translate it into hours or a daily average.
- Do not report the same duration as both a weekly total and a daily average
  unless the second view adds real context.

## Shape and voice

Use this default shape:

1. **Subject:** `<Exact Group Name> — <specific hook>`.
2. **Opening:** Lead with the week's headline, not "Here is your snapshot."
3. **Middle:** Develop two or three connected threads: the lead, the chase or
   comeback, and the group pattern.
4. **Awards:** When it fits, give two or three playful titles in one line.
5. **Close:** End with one easy question or challenge that invites reply-all.

Aim for roughly 140–220 words, with short paragraphs. A richer week can run a
little longer. Vary the structure when the data suggests something better.
Sound observant, warm, and lightly playful. Do not use report language such as
"group health snapshot," "another group member," "broadly steady," or
"focus area."

Supportive is the default. Do not shame the lowest value, moralize sleep or
exercise, or treat ordinary variation as failure. Coach-style roast requires
explicit group opt-in. In roast mode, tease claims, rivalries, confident
organizers, and effort. Do not roast bodies, diagnoses, illness, missing data,
or the person having the hardest week.

## Calibrated examples

Use these as voice and structure references, not fill-in-the-blank templates.
The fictional facts below illustrate how to organize stats; never copy a fact
or name into a real edition.

### Example 1: close race

**Subject: Morning Crew — Maya wins by two minutes a day**

Maya led the group with **41 minutes of exercise a day**, just ahead of Luis at
39. Priya averaged 35 minutes, while Jordan made the biggest jump by adding
**nine minutes of exercise a day** compared with last week.

Priya took the sleep crown with an average of **8 hours 42 minutes a night**.
Jordan followed at **8 hours 18 minutes**, up 44 minutes from the previous
week. Maya averaged just under eight hours, leaving at least one category
available for everyone else.

The group average rose from **29 to 36 minutes of exercise a day**, and three of
the four members increased their daily average.

Maya owns the exercise crown. Priya owns the pillow. Jordan owns the comeback.

Who is making a run at them next week?

### Example 2: broad momentum

**Subject: Tuesday Club — the whole group found another gear**

No runaway winner this week. Nearly everyone moved forward.

Alex exercised **about 38 minutes a day**, the highest average in the group.
Morgan finished close behind at 35 minutes, up from 24 the previous week. Sam
walked the most, averaging **11,200 steps a day**, while Lee reached 9,600, up
from 8,700.

Sleep moved with the group too. Jordan led at **8 hours 34 minutes a night**,
Lee averaged 8 hours 22 minutes, and Sam reached 8 hours 10 minutes. Morgan made
the biggest change, adding **51 minutes a night** after a shorter prior week.

Average daily exercise rose by eight minutes per person, and four members
improved both their exercise and sleep.

No dramatic takeover. Just a suspicious number of people getting consistent
at the same time.

What made this week work?

### Example 3: recovery story

**Subject: Sunday People — apparently everyone discovered bedtime**

Across five people, the group gained **nearly three combined hours of sleep per
night** compared with last week.

Priya led with **9 hours 3 minutes a night**, followed by Alex at 8 hours 41
minutes and Morgan at 8 hours 16 minutes. Four of five people slept longer than
the week before, with an average improvement of 34 minutes.

That did not make it a quiet week. Alex led at **36 minutes of exercise a day**,
Morgan climbed from 25 to 34, and Priya added 10 daily minutes over last week.
Morgan's average HRV also rose 12% from the previous week.

The useful part is not that one number "won." The group slept more while its
average exercise also rose from **27 to 33 minutes a day**.

Priya gets the pillow. Alex gets the exercise lead. Morgan gets the all-around
week.

Can you do it twice?

### Example 4: opted-in roast

**Subject: Weekend Warriors — Casey has become a scheduling problem**

Casey averaged **45 minutes of exercise a day**, seven minutes ahead of Jamie
and 16 ahead of the group. It feels less like participation and more like a
hostile takeover.

Jamie can still claim the sleep crown at **8 hours 51 minutes a night**. Taylor
followed at 8 hours 27 minutes, while Casey's campaign for total domination was
undermined by a deeply ordinary 7 hours 36 minutes.

The real comeback came from Rowan: **27 minutes of exercise a day after 14 last
week**, plus 38 more minutes of sleep each night.

As a group, you averaged **29 minutes of exercise a day**, up from 21 last week.

Casey owns the exercise crown. Rowan owns the comeback. Jamie owns the pillow.

Please argue among yourselves.

## Final check

Before sending, verify all of the following:

- The subject starts with the exact saved newsletter name.
- Every fact came from returned, consented shared data.
- Durations use human units rather than raw minute totals.
- The email has one recognizable weekly story.
- Cross-person comparisons are accurate and use consistent units.
- No missing-data or lowest-performer callout slipped in.
- Roast language, if any, matches explicit opt-in and stays on effort or group
  lore.
- The closing gives the group something easy to reply to.
