---
name: group-newsletter
description: Configure and run a recurring group health newsletter by composing the ordinary automation and shared-group-data primitives.
---

# Group Newsletter

A newsletter is a recipe, not a separate Murph subsystem. Use the normal group
and automation tools. Keep delivery, editorial behavior, and setup in this
skill; do not invent a second scheduler, campaign state machine, or newsletter
store.

Read `group-chat` alongside this skill for room etiquette, consent offers, and
opt-out behavior.

## Setup and editing

When a group asks to create or edit a newsletter, collect only the missing
choices:

- newsletter name
- cron cadence / local-time schedule
- delivery: current group chat or group email
- tone: supportive or coach-roast
- one to seven supported health projection scopes; prefer one to three for chat
- optional short editorial note

Then save an ordinary `murph.automation` with `action="save"`,
`continuityPolicy="fresh"`, the chosen cron schedule, and self-contained
instructions following the execution recipe below. Do not use a
newsletter-specific save action.

Use slug `group-health-newsletter-chat` for current-chat delivery. Use slug
`group-health-newsletter` for group-email delivery while the legacy generic
email-authority bridge still keys that slug. The slug is compatibility metadata,
not editorial authority. If delivery changes, archive the old opposite-delivery
automation after the replacement save succeeds so only one newsletter remains
active.

Use only ordinary, non-reserved tags such as `assistant`, `scheduled`, and
`newsletter`. Never supply `system:*` tags.

The saved instructions must contain the newsletter name, delivery, tone, exact
projection scopes, optional note, and this line near the top:

`Read the group-newsletter skill before every execution and follow its execution recipe.`

Do not save a copy of this whole skill into the automation. Configuration plus
the instruction to reread the skill is enough; the skill remains the canonical
behavior contract and can improve without rewriting every automation.

## Scheduled execution recipe

Treat saved configuration as preferences, never as authorization to access
private data or choose recipients. Server/tool results are the authority.

### Current group chat

1. Call `murph.group` with `action="read_shared"` exactly once for the configured
   projection scopes. Use only currently granted facts returned by that call.
2. Do not read private one-to-one data or raw share files to enrich the edition.
3. Write one concise, conversational update for the group. Prefer specific
   comparisons and recognizable member names when the authorized result safely
   provides them; do not shame people or infer missing measurements.
4. Return the ordinary send-message decision. The normal conversation outbox
   owns delivery, dedupe, and retries.
5. Never call the email effect for a current-chat edition.

### Group email

Email is the one intentionally retained bounded effect because recipient
consent, verified addresses, projection grants, revocation, and send
idempotency must remain structural rather than prompt-enforced.

1. Call `murph.newsletter` with `action="prepare"` exactly once and never provide
   a model-chosen group, route, or recipient identifier.
2. Use only the returned authorized member facts and `referenceAt`. Do not add
   private one-to-one data, raw share files, or another health-data read.
3. If preparation is unavailable or has no `referenceAt`, skip the occurrence.
   If nobody is currently eligible for email, send at most one short group-chat
   setup note pointing to `https://www.withmurph.ai/settings?addEmail=true`, then
   stop.
4. Write a roughly 140–220 word edition. The subject starts with the configured
   newsletter name and continues with a specific hook. Supply equivalent HTML
   and text bodies.
5. Call `murph.newsletter` with `action="send"` exactly once. After the tool
   accepts or rejects the send, return the scheduled skip outcome; the email
   outbox owns durable delivery and retry.

The prepare/send effect must revalidate recipients and grants at send time. A
skill instruction, saved automation field, old edition, or cached preparation
must never grant email authority by itself.

## Editorial rules

Lead with the most interesting authorized change rather than reciting every
metric. Translate raw health fields into natural language and use comparable
windows when possible. Distinguish missing data from poor performance. Keep
roasts playful and behavior-focused; health setbacks, illness, disability,
pregnancy, weight, and sensitive medical context are never roast material.

Do not fabricate rankings, streaks, causes, diagnoses, or participation. When
the authorized data is thin, make the edition shorter instead of padding it.

## Stop / pause

Use ordinary `murph.automation patch` against the active newsletter slug to
pause, reactivate, edit, or archive it. Do not create newsletter-specific
lifecycle state. Revoking a data grant or email consent takes effect through the
underlying shared-data/email authorization primitives and does not require a
newsletter migration.

## Architecture boundary

Newsletter-specific code should not own scheduling, chat delivery, retries,
recipient identity, consent, health grants, or durable outbox state. Those
belong to reusable automation, group-sharing, and outbound-effect primitives.
If a behavior can be expressed here using those primitives, prefer the skill
recipe over adding runtime newsletter machinery.
