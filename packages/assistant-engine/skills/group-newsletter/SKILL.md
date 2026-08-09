---
name: group-newsletter
description: Set up and run a recurring group health newsletter as an ordinary Murph automation, with optional consented group-email delivery.
---

# Group Newsletter

Use this skill when a group asks to create, edit, stop, or run a recurring health newsletter, and on every scheduled group-health-newsletter run. Newsletter is a recipe over normal group primitives, not a separate product subsystem.

## Set up or edit

Ask only for missing choices that materially change the result:

- name
- schedule and timezone
- delivery (`current_chat` or `group_email`)
- one to three shared projection scopes for chat, or the desired email scopes
- tone (`supportive` or an explicitly opted-in light coach roast)
- any custom editorial note

Save one ordinary group-scoped automation with `murph.automation action="save"`:

- use a stable slug such as `group-health-newsletter`
- use `continuityPolicy="fresh"`
- put the complete recipe in `instructions`, including “read the group-newsletter skill before every execution,” the selected scopes, tone, delivery, and custom note
- omit `delivery` for chat, or use `delivery="current_conversation"`
- use `delivery="group_email"` only when the group explicitly chose email

Do not use the retired `murph.automation action="save_newsletter"` path for new setup. It exists only for migration compatibility.

For edits, patch the existing automation when possible. For stop or cancel, archive it. Never run another group or accept a model-supplied group, member, route, recipient, or vault identifier.

## Read authorized facts

For `current_chat`, do not call `murph.newsletter`. Call `murph.group action="read_shared"` once for the exact configured scopes. Use only currently granted and available facts in that result and follow `group-chat`'s **Shared fact limits**.

For `group_email`, call `murph.newsletter action="prepare"` exactly once. Use only `members` and the returned `referenceAt`; those are the currently eligible email recipients and their authorized shared facts. If `prepare` is unavailable, lacks `referenceAt`, or provides no usable authorized facts, do not compose or call `send`. Return `{"kind":"skip","privateSummary":"..."}` unless the runtime contract explicitly asks for the short add-email recovery message.

A current absence proves only an authorized current permission or data-availability state. Never attribute the absence to sync or permissions without evidence, and do not present it as the historical cause of an earlier result. The consented eight-record projection is a bounded current snapshot, not a complete longitudinal record.

## Compose each edition

Write a small editorial story, not a dashboard dump. Usually include 6–12 useful stats, but fewer is better than padding. Never expose dashboard language, internal scope names, share IDs, participant IDs, eligibility state, or tool mechanics.

Use ordinary human units and labels. About 30 minutes of movement a day is clearer than an unexplained active-minute aggregate. Keep them separate: workouts, exercise minutes, steps, sleep, heart rate, and HRV are distinct signals. A daily workout-count record is evidence for that date only, never as a daily or weekly exercise total. Do not use `workout-count` to claim a weekly workout total.

Use the seven local calendar days before today. Exclude today and anything older than that rolling window. Compare people or periods only when every compared date set is identical. When coverage differs, report scoped values or an unranked pattern. Do not claim a prior-week change without a valid matching prior window.

Cross-person comparisons are welcome when they are fair, legible, and socially useful. Do not rank missing or unequal coverage. Avoid medical conclusions, diagnosis, shame, false precision, and pressure to disclose more data.

For a roast tone, use only light, reversible jokes the group explicitly opted into. Roast behavior, not bodies, illness, disability, medication, sleep disorders, fertility, substance use, or mental health.

### Example 1: close race

“Sam edged Maya by 1,240 steps across the same seven days, while Maya held the steadier sleep schedule. Tuesday was the group’s strongest movement day.”

### Example 2: opted-in roast

“Alex won the step race by treating every grocery aisle like a playoff possession. Jordan’s bedtime remains an independent research project.”

## Deliver

For current chat, return one concise conversational message. The normal conversation outbox owns delivery and retry.

For group email:

1. Subject format: `<Exact Newsletter Name> — <specific hook>`.
2. Produce equivalent HTML and text bodies.
3. Call `murph.newsletter action="send"` exactly once after a successful same-turn prepare.
4. After any email `send` result, return a skip decision. Do not retry `send` in the same turn; the runtime owns delivery, retry, and idempotency.
5. If nobody can currently receive email and the runtime contract permits a recovery message, send one short group message linking to `https://www.withmurph.ai/settings?addEmail=true`. Do not name or shame missing recipients.

Before finishing, verify that the edition used one authorized data path and exactly one delivery path.
