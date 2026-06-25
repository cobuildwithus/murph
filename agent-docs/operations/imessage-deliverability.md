# iMessage Deliverability and Reply Safety

Last verified: 2026-06-25

## Purpose

This is the mandatory guide for any Murph change that can affect text-message or iMessage behavior. Read it before editing assistant/provider prompts, reply generation, outbound copy, reminder behavior, notification behavior, message scheduling, line selection, delivery monitoring, onboarding copy, or any runtime path that can cause Murph to send a message through a phone-number based channel.

The core rule is simple: design Murph messaging like a real reciprocal conversation, not a broadcast system. The highest-risk pattern is many outbound messages from one line with little or no recipient response.

## When this applies

Read and apply this guide when touching any of these surfaces:

- prompts that influence what Murph says to a user over SMS/iMessage
- code that decides when Murph sends, retries, schedules, batches, or suppresses a message
- onboarding, confirmation, reminder, alert, follow-up, or re-engagement flows
- phone-line provisioning, contact-card setup, line rotation, warmup, or health checks
- delivery receipt ingestion, failure handling, line status, or support/debug tooling
- product copy that will be sent through a phone-number based channel, even if generated indirectly by the assistant

## Non-negotiable product requirements

1. Optimize for recipient replies early.
   - Design each new conversation to earn a real recipient reply within the first three outbound messages.
   - Prefer genuine questions over one-way statements.
   - For one-way use cases like reminders or alerts, establish the thread first with an explicit confirmation such as "Reply YES to confirm" before sending repeated notifications.

2. Avoid broadcast-shaped behavior.
   - Do not send many new conversations from one line without replies.
   - Do not bulk re-engage cold contacts who have not replied in 30+ days.
   - Do not reuse one line for manual and automated messaging unless the automated sender is rate-aware and shares line-health state.

3. Keep content human and specific.
   - Vary messages through real context: name, current task, recent user intent, or the user's actual protocol/reminder state.
   - Do not fake variation with random padding, filler, invisible characters, or arbitrary synonym churn.
   - Avoid acquisition, signup, notification, marketing-blast, or imperative exact-send framing in prompts and templates.

4. Treat links as high risk.
   - Never use shortened URLs such as bit.ly or tinyurl in iMessage/SMS copy.
   - Prefer full first-party URLs on a domain the recipient can recognize.
   - Avoid making the first exchange primarily a link drop. Ask a reply-oriented question first when possible.

5. Pace sends conservatively.
   - Keep net-new conversations below 50 per day per line unless there is an explicit line-distribution plan and line-health monitoring.
   - Spread sends across time instead of bursting many messages in a short window.
   - Warm up new lines gradually, starting around 10-20 outbound conversations per day for the first week before increasing.
   - Avoid sending between 11pm and 5am in the recipient's local time unless the user explicitly configured that behavior or the use case truly requires it.

6. Make new lines earn trust before scaling.
   - Treat the first two weeks of any new line as a warmup period.
   - Prefer real inbound conversations early.
   - Set up the provider contact card for every line and route onboarding so users can save the contact.
   - Avoid the pattern of a new line sending a burst and then going silent.

7. Monitor and fail closed on line health.
   - Watch delivery receipts. "Sent" without "delivered" can indicate silent dropping.
   - If delivery failures spike on a line, immediately reduce or stop automated volume on that line.
   - If a line is suspected or known flagged, stop all automated sending from it until line health is investigated.
   - Do not retry through a flagged line in a way that increases volume or repeats the same content.

8. Never message low-trust sources.
   - Do not send to purchased, scraped, or otherwise untrusted contact lists.
   - Only message people with a clear user/product relationship and an expected reason to hear from Murph.

## Implementation checklist

Before shipping any change that can send or shape an outbound message, answer these questions in code review:

- What reply is this flow trying to earn in the first three outbound messages?
- Does the first or second message ask a real question a recipient can answer easily?
- Does the flow stop, slow down, or change behavior when the recipient does not reply?
- Are outbound count, inbound reply count, last inbound time, last outbound time, line id, delivery state, and recipient local time available to the sender or scheduler?
- Are net-new conversations and bursts limited per line, not just globally?
- Are new lines treated differently from warmed lines?
- Are cold contacts with no reply in 30+ days protected from bulk re-engagement?
- Are shortened URLs impossible in this path?
- Are delivery failures and silent-drop signals able to suppress future sends?
- Could this template be sent identically to many recipients? If yes, what real user context makes it specific?

If the answer is unknown, do not assume the path is safe. Add the missing guard, state, or documentation before expanding volume.

## Prompt and copy guidance

Preferred shape:

- short, conversational, and specific to the recipient
- one clear question when Murph needs to build trust or confirm intent
- clear continuation of an existing user-requested thread
- full recognizable URLs only when links are necessary
- calm, non-salesy language

High-risk shape:

- "Here's your update" followed by a link as the first contact
- repeated reminders that never ask the user to confirm, pause, or adjust
- batches of identical copy
- shortened links
- marketing, acquisition, referral, or signup pressure
- exact-send instructions in provider prompts that make the assistant behave like an automated outreach tool

## Review guidance for agents

When reviewing or editing a messaging path, look across the whole flow, not just the template. A safe message can still be unsafe if it is sent too often, too late, from a cold line, through a flagged line, or into a thread with no replies.

A complete review should inspect:

- prompt text and system instructions
- message generation helpers and templates
- scheduler, retry, queue, cron, and batch code
- line selection, warmup, and contact-card setup
- delivery receipt ingestion and suppression behavior
- cold-contact and inactive-thread handling
- tests or fixtures that prove the guardrail

If a path lacks line-level pacing, recipient reply tracking, or delivery-health suppression, treat that as a deliverability risk even if the copy itself looks fine.
