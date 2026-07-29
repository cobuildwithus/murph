---
name: group-newsletter
description: |
  Write, set up, edit, or send Murph's recurring group health newsletter in
  the current iMessage or Telegram group chat or by consented group email.
  Read during setup and on every scheduled `group-health-newsletter` run.
  Owns the weekly editorial story, natural presentation of exercise, sleep,
  steps, and trends, supportive or explicitly opted-in roast tone, and the
  final edition. Use group-chat alongside this skill for room etiquette,
  email consent offers, and opt-out behavior.
---

# Group Newsletter

Write the edition that makes the group want to reply. It should feel like a
friend noticed what happened this week, not like a wearable exported a report.
Use the shared numbers generously when they make the story better.

Read `group-chat` alongside this skill during setup or a live group
conversation. This skill owns the newsletter's editorial decisions and final
edition; `group-chat` owns room behavior, email consent offers, and opt-out
handling.

## Set up the scheduled run

Keep one `group-health-newsletter` cron automation in the group vault for
either delivery mode. During setup, follow the questions, email consent,
schedule, notice, and first-send rules in `group-chat`.

Create or replace it only with `murph.automation action="save_newsletter"`.
Supply the chosen `newsletterName`, cron `schedule`, `delivery`
(`current_chat` or `group_email`), `tone`, exact `healthScopes`, and optional
`customNote`. Do not hand-author generic automation instructions, a slug, or
reserved system tags. The structured action writes canonical configuration,
binds it to the current group route, and lets the runtime append the current
execution contract on every scheduled run. Current-chat delivery uses one
bounded shared read, so select at most three health scopes; email may use the
full supported set.

## Compose each edition

1. Follow the trusted execution contract appended to the scheduled automation
   prompt. The saved block supplies the exact name, delivery, tone, health
   scopes, and custom note. Normal conversation and tools remain available,
   but do not use them as alternate health-data sources for the edition.
2. For `group_email`, call `murph.newsletter` with `action="prepare"` and no
   group or route identifier. This returns recipient
   eligibility, the scheduled `referenceAt`, and `members` containing
   seven-completed-day facts only for currently eligible email recipients. The
   trusted runtime starts this authority and data work only after the model calls the tool. It
   resolves the current eligible participants and exact member/scope grants,
   then returns seven-completed-day facts from a direct bounded Web snapshot. No
   roster, grant snapshot, or shared-data block is preloaded before model
   start. Use only `members`. Never run another group-health read, open raw
   `vault-share/**` or legacy `derived/vault-share/**` files, or fetch private
   1:1 data for the email.
   If `prepare` is unavailable or fails, or `referenceAt` is null,
   do not compose or call `send`; return a `skip` notification decision with a
   factual private summary and stop.
3. Build the featured set only from returned members with at least one
   `weeklyStats` entry. Never use or mention any participant outside `members`
   in the subject, HTML body, or text body. Each email `weeklyStats` entry
   reports `completedDaysAvg`, `observedDayCount`, `observedDates`, and
   `throughDate`; treat those fields as its completed-date coverage.
4. Find the week's story before writing. Prefer a close race, clear leader,
   surprising combination, or broad recent group pattern.
5. Choose the facts that develop that story. Usually include 6–12 useful stats,
   but use more or fewer when the week warrants it. Do not give every person
   the same fields merely because they are available.
6. For `group_email`, write the subject, HTML body, and equivalent text body.
   Then call `murph.newsletter` with `action="send"` once and no group or route
   identifier. If email eligibility or any
   health-data grant changed after preparation, send fails closed; do not reuse
   the already-composed body.

For `current_chat`, do not call `murph.newsletter` and do not require email
sharing. Call `murph.group action="read_shared"` once for the exact saved health
scopes, use only the currently granted facts it returns, and apply the
completed-day comparison rule below. Return one concise `send_message` edition.
The ordinary conversation outbox delivers it to the automation's bound
iMessage or Telegram group route.

For either delivery mode, compare each member and metric only over its sorted
usable completed dates. Email uses `observedDates`; current chat derives the
equivalent set from records usable under `group-chat`'s **Shared fact limits**
and dated within the seven local calendar days before today. Exclude today and
anything older than that rolling window. State the date scope for each average.
Declare a settled cross-person leader, winner, or crown only when every compared
date set is identical. When coverage differs, report scoped values or an
unranked pattern. Never treat unobserved days as zero or imply that a partial
week is complete.

After any email `send` result—including sent, partial failure, no recipients,
unavailable, or failed—do not retry `send` in the same turn. Return the
notification decision `{"kind":"skip","privateSummary":"..."}` with a short
factual private summary. The email tool or runtime owns delivery, retry, and
backoff; never return `send_message`, a digest, an operational error, or a
delivery confirmation that would create a second message on the bound group
channel.

If `participants` contains no participant with `hasEmail === true`, do not send
an empty edition. Return
one `send_message` notification decision telling the group that there are no
eligible email recipients yet and pointing them to
`https://www.withmurph.ai/settings?addEmail=true`,
then stop for that run. If participants can receive the email but the featured
set is empty, send a short email without health comparisons. Never mention who
failed to share, who lacks an email, or who had insufficient data.
Do not invent a cause for empty stats: say only that no usable completed-day
stats were returned, never that data failed to sync or permissions were missing.

## Turn stats into a story

Cross-person comparisons are welcome within the featured set. Compare exercise,
movement, steps, sleep duration, sleep timing, consistency, and other consented
group metrics when the comparison is interesting.

Do not declare anyone the healthiest person or turn one biomarker into a
verdict. For HRV, resting heart rate, weight, symptoms, or similar
context-dependent measures, prefer personal change and group-level patterns
unless the group explicitly chose that metric for a challenge. State
associations and observations without claiming that one metric caused another.

Give numbers jobs. Each number should establish at least one of:

- a leader or close race;
- a meaningful recent group pattern;
- a surprising contrast;
- context for the week's central joke or observation.

Cut a number that only proves the tool returned it. Never write a census such
as one sentence per member with the same metric template.

## Use human units

Never expose dashboard language such as a raw total of active minutes.

- Render broad movement as a daily average: "about 30 minutes of movement a
  day." Describe workout duration only as an average per recorded workout day.
- For a close race, keep useful precision: "41 minutes a day, only two minutes
  ahead of Luis."
- For sleep, use hours and minutes per night: "8 hours 42 minutes a night."
- Round when extra precision adds nothing. Keep exact minutes when the closeness
  is the point.
- Keep units consistent inside a comparison.
- Broad movement and workout duration are different. Keep them separate.
  Present workout duration as minutes on recorded workout days, never as a
  daily or weekly exercise total.
- Do not use `workout-count` to claim a weekly workout total, rank who completed
  the most workouts, or say someone completed workouts on unobserved days. Its
  completed-day average covers recorded workout days only and omits zero days.
- Do not claim a prior-week change, comeback, monthly high, or four-week high.
  The consented seven-record projection supports only the returned
  seven-completed-day averages.
- For other sources, say "exercise" only when the value represents workouts or
  exercise. Say "movement" only when an explicit semantic owner identifies
  broad movement, and still translate it into hours or a daily average.
- Do not report the same duration as both a weekly total and a daily average
  unless the second view adds real context.

## Shape and voice

Use this default shape:

1. **Email subject:** `<Exact Newsletter Name> — <specific hook>`.
2. **Opening:** Lead with the week's headline, not "Here is your snapshot."
3. **Middle:** Develop two or three connected threads: the lead, the chase, and
   the group pattern.
4. **Awards:** When it fits, give two or three playful titles in one line.
5. **Close:** End with one easy question or challenge that invites reply-all.

Aim for roughly 140–220 words for email and a shorter conversational update for
chat, with short paragraphs. A richer week can run a little longer. Vary the
structure when the data suggests something better.
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

Maya led the group with **41 minutes of movement a day**, just ahead of Luis at
39. Priya averaged 35 minutes, keeping all three within one good walk of each
other.

Priya took the sleep crown with an average of **8 hours 42 minutes a night**.
Jordan followed at **8 hours 18 minutes**. Maya averaged just under eight hours,
leaving at least one category available for everyone else.

Maya owns the movement crown. Priya owns the pillow.

Who is making a run at them next week?

### Example 2: opted-in roast

**Subject: Weekend Warriors — Casey has become a scheduling problem**

Casey averaged **45 minutes of movement a day**, seven minutes ahead of Jamie.
It feels less like participation and more like a hostile takeover.

Jamie can still claim the sleep crown at **8 hours 51 minutes a night**. Taylor
followed at 8 hours 27 minutes, while Casey's campaign for total domination was
undermined by a deeply ordinary 7 hours 36 minutes.

Rowan logged the longest recorded workout days at **about 52 minutes each**,
while Casey's were shorter and apparently more frequent. Those are different
facts; neither is a weekly total.

Casey owns the movement crown. Jamie owns the pillow. Rowan owns the long shift.

Please argue among yourselves.

## Final check

Before sending, verify all of the following:

- For email, the subject starts with the exact saved newsletter name.
- Every fact came from returned, consented shared data.
- Durations use human units rather than raw minute totals.
- The email has one recognizable weekly story.
- Cross-person comparisons are accurate and use consistent units.
- No member-specific missing-data or lowest-performer callout slipped in.
- Every settled comparison passed the completed-date rule.
- Roast language, if any, matches explicit opt-in and stays on effort or group
  lore.
- The closing gives the group something easy to reply to.
