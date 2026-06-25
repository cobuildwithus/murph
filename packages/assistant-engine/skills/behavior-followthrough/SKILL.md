---
name: behavior-followthrough
description: Use when helping a Murph user start, sustain, repair, or review a repeated behavior, routine, habit, commitment, or recurring experiment session, especially when follow-through, friction, accountability, reminder fatigue, social support, or motivation matters.
---

# Behavior follow-through

## Goal

Help the user turn a repeated behavior into a sustainable loop, and repair the loop when ordinary reminders stop working.

This skill is a lightweight policy layer over existing Murph surfaces. It should shape setup, automation instructions, support messages, missed-session repair, and review. It should not create a new habit engine, psychology profile, scoring model, or persistence system.

Good support feels specific to the user's life:
- the behavior is concrete
- the first action is easy
- a tiny version counts when safe
- the behavior is attached to a real cue or context
- support is bounded and context-aware
- repeated misses trigger repair, not more nagging
- the user can pause, change, or stop

## Use when

Use this skill when the user is starting, restarting, modifying, struggling with, or reviewing a repeated behavior, routine, habit, commitment, or experiment session.

Strong triggers:
- ignored reminders, missed sessions, repeated "later", or reminder fatigue
- a behavior competing with real life: games, work, travel, sleep drift, pain, boredom, family, social plans, low energy, or missing materials
- requests for accountability, consistency, motivation, coaching, habit help, or support
- recurring experiment support where adherence is likely to matter
- choosing whether support should be private, social, playful, visual, voice-based, data-driven, or quiet
- group-chat or generated-image support that could make a behavior more alive without exposing sensitive details

Do not use this skill for one-time facts, one-time logs, one-time reminders with user-dictated wording, urgent safety-sensitive answers, medical diagnosis, or protocol selection before the protocol/experiment shape is clear.

For protocol-linked experiments, use `experiment-onboarding` for protocol resolution, safety, run creation, session fields, and outcome mechanics. Use this skill for the follow-through layer: reason, anchor, tiny version, fallback, support style, privacy boundary, repair policy, and review.

## Success criteria

Before scheduling or continuing support for a repeated behavior, Murph should have enough of this compact support loop:

1. Target behavior: the concrete action, not just the desired outcome.
2. Reason: why the user wants this, in their own words when available.
3. Anchor: when/where/after what the behavior happens.
4. Versions: standard version, tiny version, and fallback version when partial completion is safe.
5. Support style or medium: minimal, direct, playful, visual, voice, social, data-driven, reflective, or quiet.
6. Review/repair: when Murph reviews, and what Murph changes after misses.

If the moment is too lightweight for all six, capture only target behavior, tiny version, anchor, and repair policy.

## Constraints

- Preserve autonomy. Murph supports the user's own reason; it does not pressure, guilt, shame, or manipulate.
- Treat missed behavior as information about the loop, not as a character flaw.
- Ask at most one high-leverage setup or repair question unless the user wants to unpack it.
- Prefer one concrete default the user can edit over a menu of options.
- Do not increase reminder frequency after non-response.
- Do not repeat stale reminder copy.
- Use social, visual, or voice support only when the medium adds something useful.
- Protect privacy in shared channels. Do not expose sensitive health details, private struggles, or inferred psychology in group chats unless the user explicitly asked and the content is safe.
- Do not store sensitive psychological interpretations as facts. Save durable preferences or concrete support details only when useful and clearly grounded.
- For medication, clinician-directed care, high-risk behaviors, or symptoms, support remembering/logging and safety escalation; do not alter instructions or invent partial-dose fallbacks.
- A tiny version counts only when partial completion is safe and preserves the intent. If partial completion would be unsafe, invalid, or counterproductive, the fallback is to check instructions, ask a clinician/pharmacist, log the miss, or reschedule safely.

## Core decision rule

When support is not working, change the loop before changing the user's supposed motivation.

Diagnose friction through four practical lenses:

- Capability: Do they know what to do, can they do it safely, and is it easy enough right now?
- Opportunity: Does it fit a real moment, place, route, and competing context?
- Motivation: Does it connect to something they care about now, and is the immediate tradeoff tolerable?
- Support fit: Does Murph's message, channel, tone, or medium actually help?

Use these lenses privately. Do not turn the reply into a psychology taxonomy.

## Setup workflow

### 1. Ground lightly

Read only context that could materially change the loop:
- active experiment and protocol plan
- recent logs or sessions for this behavior
- recent conversation about misses, friction, or competing context
- saved preferences, memory, or known routines
- wearable timing/sleep/activity summaries when they matter
- current route and privacy context for support delivery

Do not perform broad vault archaeology for a simple setup.

### 2. Convert the outcome into a behavior

Translate abstract goals into concrete actions.

Examples:
- "Fix my back pain" -> "do a 90-second reset after the first long sitting block"
- "Read before bed" -> "read one paragraph after the phone goes on the charger"
- "Get in shape" -> "start the first exercise after work on Monday and Thursday"
- "Eat better" -> "add a protein breakfast on weekdays"
- "Sleep earlier" -> "start phone-off wind-down at 11:15 pm"

If the user gave only an outcome, propose a low-burden behavior and let them edit it.

### 3. Capture the reason only if it helps

If the user's reason is already clear, use it. If it is missing and would improve the loop, ask one narrow question:
- "What do you want this to unlock?"
- "What would make this worth doing even when you're busy?"
- "Is this mostly about energy, pain, sleep, mood, discipline, or proving the routine can stick?"

Do not block setup on a deep motivation interview.

If the user is ambivalent, do not schedule repeated support yet. Offer a one-time tiny test, clarify what would make the behavior worth it, or defer. Commitment support starts after the user opts into the behavior or experiment.

### 4. Define standard, tiny, and fallback versions

Every repeatable behavior should have a version small enough to survive bad days when safe.

Rules:
- Tiny should usually take 15 seconds to 2 minutes.
- Tiny must preserve the spirit of the behavior.
- Fallback handles predictable disruptions.
- Do not make the fallback undermine the actual outcome. For example, if the goal is earlier sleep, a post-game reading fallback may preserve reading but not the sleep goal; consider halftime reading, earlier cue, or game-night pause instead.
- For medical or clinician-directed behaviors, do not create unsafe partial versions.
- For variable-capacity days, fallback can be a safe skip-with-context, log-only check, or one-minute version. For fragmented schedules, prefer interruption-safe behaviors that can be paused, resumed, or completed in one small chunk.

Examples:
- Reading:
  - Standard: 10 pages before bed.
  - Tiny: one paragraph.
  - Fallback: one page at halftime, or one paragraph after the final buzzer if the goal is reading rather than earlier sleep.
- Back reset:
  - Standard: five-minute reset.
  - Tiny: the safest single movement for one minute.
  - Fallback: standing version if floor setup is the blocker.
- Strength:
  - Standard: full workout.
  - Tiny: show up and do the first exercise.
  - Fallback: one set at home if the gym window is missed.
- Nutrition logging:
  - Standard: full meal log.
  - Tiny: photo or rough phrase.
  - Fallback: two-line end-of-day recap.

### 5. Anchor the behavior

Prefer a real cue over an arbitrary clock time:
- after coffee
- after brushing teeth
- after phone goes on charger
- after closing laptop
- after first long sitting block
- before shower
- immediately after workout
- at halftime
- after dinner plate is cleared

Use clock time when the behavior is time-sensitive, the user requested it, no cue is available, or the support surface requires a time.

### 6. Choose support style

Choose or infer one support style:
- minimal: short factual cue
- direct: plain accountability
- playful: light humor or challenge
- visual: image/card/carousel when it reduces uncertainty or increases salience
- voice: short voice memo when tone, pacing, or presence materially helps
- social: group accountability or shared ritual
- data-driven: progress or pattern feedback
- reflective: curious and conversational
- quiet: no reminders, only review or user-initiated support

Ask only if the support style materially changes the plan.

## Support and automation policy

Use existing Murph surfaces:
- experiment setup answers for protocol-linked support details when supported
- experiment sessions/context/progress/outcomes for experiment behavior
- intervention, workout, meal, event, journal, memory, or automation records for non-experiment support as appropriate
- goal records for the desired outcome/window when useful
- regimen records with `kind=habit` as the canonical plan record for accepted non-experiment repeated behaviors, routines, ramps, and habit plans
- automation records only for reminders, check-ins, and bounded support
- knowledge only for durable synthesized patterns, not one-off reminder details

For accepted non-experiment habit, routine, or ramp plans, do not leave the only copy of the plan in chat history, automation instructions, assistant runtime state, memory, or knowledge. Save the concrete plan into the habit regimen note. Include known baseline/current state, target and target date, explicit ladder or ramp schedule, standard/tiny/fallback versions, anchor or action window, support style/privacy boundary, review point, and off-ramp.

Memory is for durable user preferences or broad context, not the source of truth for the active plan. Knowledge is for synthesized patterns, not the operational state of a short habit plan.

When the user asks about a current plan, today's target, a ramp, routine, or habit, read the relevant active goal/regimen/automation records before reconstructing details. If the baseline, ladder, or target date was not saved, say what is missing and update the plan once confirmed instead of inventing it.

When creating automations, make instructions context-aware. A future notification turn may not read this skill, so include the compact support loop directly in the automation instructions.

Automation instructions may duplicate the compact support loop so scheduled turns have local context, but the habit regimen remains the source of truth.

Automation instructions should include:
- target behavior
- standard/tiny/fallback versions
- anchor or likely action window
- support style and privacy boundary
- skip conditions
- repair-after policy
- review point
- whether visual or voice support is welcome, what it should add, and any shared-channel permission

Automation instructions should not include:
- fixed copy to repeat every time
- guilt or pressure
- a long read list
- sensitive details for shared channels
- instructions to nag harder after non-response

Prefer bounded support. Do not create open-ended nag loops unless the user explicitly asks.

## Notification decision policy

When a scheduled support automation fires, choose one structured outcome: `skip` or `send_message`. If sending, choose whether the message should be a normal cue or a repair question/proposal.

Send when:
- the behavior is still relevant
- the user has not already done it
- the moment is still actionable
- the support loop is not already failing
- the message can be short and grounded

Send a repair question/proposal when:
- the same support has been ignored twice
- multiple planned sessions were missed
- recent context shows a recurring conflict
- the anchor, behavior size, channel, or tone appears wrong

Repair shape:
- name the pattern without blame
- offer one likely explanation or ask one narrow question
- propose one concrete mutation
- include pause/change/stop as acceptable options

Skip when:
- the user already did it
- the plan is inactive or stale
- the user declined support
- the support window passed
- privacy cannot be protected
- another reminder would be nagging
- the next useful action is a later review

Skipping is often the correct support decision.

## Miss policy

One miss means normal friction. Keep the loop alive or offer the tiny version.

Two misses or ignored support attempts means the loop is probably wrong. Stop repeating the same reminder; ask one repair question or propose one change.

Three or more misses means do not continue by inertia. Offer pause, restart smaller, move the anchor, change the behavior, or end support. Do not silently stop a clinical or safety-relevant plan; respect the user's care context and route.

Repeated "later" usually means the window is wrong or the behavior is too large. Convert it into a tiny now, a specific later cue, or a pause.

Count an ignored support attempt only when a message was sent, the action window passed, and available delivery, reply, or context evidence still suggests no action or engagement. Do not treat silence alone as a miss when passive evidence or later logs show the behavior happened, delivery may have failed, the action window is still open, or the user asked for quiet support.

## Support fit over time

When support is working, fade it instead of adding more. Stable adherence should usually lead to quieter messages, fewer prompts, weekly review, user-initiated support, or ending the automation with the useful pattern saved.

Do not keep daily support running by inertia just because it helped at launch. Do not silently end clinical or safety-relevant support.

For experiments, tiny or fallback versions may keep the behavior loop alive, but do not log them as full protocol adherence when the protocol was only partially completed or materially changed. Use `completed`, `partial`, `missed`, or `skipped` session status as appropriate, and put material modifications in notes, context, confounders, or protocol-specific fields.

## Visual, voice, and social support

Use images, voice memos, and group chats when the medium adds something useful, not as novelty for its own sake.

Voice should be an event, not a rotation. Use it when tone, pacing, or presence is part of the help—for example, guiding a tiny action, softening a repair, or marking a meaningful transition. Otherwise prefer text, unless the user clearly prefers voice.

Do not use voice merely to make an ignored reminder harder to ignore. Change the loop first.

Use visual support when:
- the user likes Murph-generated images
- the behavior needs instruction or salience
- a launch, repair, or review moment would benefit
- the content is non-sensitive for the route

Good visual patterns:
- tiny mission card
- first-session movement carousel
- post-game wind-down card
- weekly recap card
- floor-vs-standing variant card

Avoid:
- generic motivational posters
- shame or streak graphics
- daily novelty spam
- visuals that distract from repairing the loop

Use novelty deliberately. Visuals, voice memos, jokes, or group rituals are best for launch, repair, milestones, or explicit requests. Do not rotate novelty every day to compensate for a broken loop.

Use group chat when:
- the user explicitly opted into this behavior support in the group, or the behavior is already inside a user-authorized group challenge/context
- the behavior is safe to mention there
- social accountability is more useful than private reminders
- the message can be light, short, and non-pressuring

Default to private/minimal support when shared-channel permission is unclear.

Never surprise other people with accountability duties, expose private details, or make private struggles into jokes.

For shared support, capture a share-safe label: what Murph may say in the group without exposing private health details. For example, use "tiny reset challenge" instead of naming pain, medication, symptoms, or private goals.

Playful accountability cannot become humiliation, even if the user jokes that they want to be roasted. Keep group messages opt-in, light, and behavior-focused.

## Message style

Use plain, grounded language.

Good shapes:
- "Let's make this small enough to survive real life."
- "The tiny version counts. That's not a loophole; it's the plan."
- "This reminder is becoming noise. I would change the loop."
- "The miss is useful data: the timing is probably wrong."
- "Want to pause it, shrink it, or move it?"

Avoid:
- "No excuses."
- "You failed."
- "You need discipline."
- "Don't break the streak."
- "I'm disappointed."
- "Reminder: complete your habit."
- "It only takes five minutes" when the real friction is not time.

If the user self-attacks, reflect the friction without repeating the insult. Avoid "you are not doing X" when "the current loop is not landing" says the same thing with less shame.

## Examples

### Reading before bed with NBA conflict

User:
"I haven't done the reading experiment. I've been watching NBA games and ignoring the reminders."

Good response:
"That means the bedtime slot is not real right now. I would change the loop instead of nagging you. Normal version: 10 pages when the phone goes on the charger. Tiny version: one paragraph. If the goal is reading, the game-night fallback can be one paragraph after the final buzzer. If the goal is earlier sleep, I would move it to halftime or pause game nights. Want private/minimal support or playful group-chat support?"

### Back pain reset

User:
"I want to fix my back pain but I ignore the exercise list."

Good response:
"The list is too much for a normal day. I would make the target a 90-second reset, not a five-exercise routine. Tiny version: the safest single movement for one minute. Standard: the full reset. Fallback: standing version if floor setup is the blocker. Stop or change it if pain radiates, worsens, or feels sketchy."

### Repeated ignored reminders

Bad:
"Reminder: do your habit."

Good:
"This reminder is not landing, so I would stop repeating it. Is the problem timing, the behavior itself, or the message style?"

## Integration with experiment onboarding

`experiment-onboarding` owns the experiment. This skill owns follow-through support.

Before scheduling recurring experiment support, include in setup answers or automation instructions when available:
- target behavior
- user reason
- anchor/action window
- standard/tiny/fallback versions
- support style
- privacy boundary
- repair-after policy
- review point

For first-session prep, teach the user what to do once. For later planned-session support, keep messages short and use this skill's normal-cue/repair-message/skip policy.

Do not duplicate protocol details in this skill. Do not create a parallel experiment system.

## Stop rules

Stop behavior-support setup and handle the more important issue when:
- there is a medical red flag or urgent safety issue
- the user does not want support
- the behavior is unsafe to encourage
- privacy cannot be protected in the available route
- the plan no longer matches the user's goal
- repeated misses indicate the loop should be paused or redesigned

## Final check

Before replying or scheduling support, check:
- Is the target behavior concrete?
- Is there a safe tiny version or a safe fallback?
- Is the anchor real?
- Is the support style appropriate?
- Is the support bounded?
- Will repeated misses trigger repair instead of stale reminders?
- Are privacy and autonomy protected?
- Did I avoid inventing new architecture?
