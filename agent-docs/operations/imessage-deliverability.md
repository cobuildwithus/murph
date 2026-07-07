# iMessage Deliverability and Reply Safety

Last verified: 2026-07-07

## Purpose

This is required reading for any Murph change that can affect text-message or iMessage behavior. Read it before editing assistant/provider prompts, reply generation, outbound copy, reminder behavior, notification behavior, message scheduling, line selection, delivery monitoring, onboarding copy, or any runtime path that can cause Murph to send a message through a phone-number based channel.

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

## Murph Hosted Automation Engagement

Murph pauses model-capable automation wakes for Linq members with no inbound day in the last 28 days, using `hosted_linq_daily_state` as the source of truth. Conversational replies are never gated by this pause because fresh conversation mailbox lag bypasses it. First-contact, participant identity, and route-authority checks remain separate authority checks and still fail closed.

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

#### Reciprocity Is Everything

Design your messaging flows to get a reply within the first 3 messages. Apple's TrustKit skips all spam checks once a chat has 3 or more replies from the recipient. This is the single most important thing you can do.

- Ask questions. "Hey, is this still a good number for you?" beats "Here's your update." Questions get replies. Replies build trust.
- Avoid one-way broadcast patterns. If you are sending 50 messages and getting 0 replies, Apple's ML is scoring every one of those as spam-like. Even 1 reply per 10 outbound messages changes the math.
- If your use case is inherently one-way, such as notifications or alerts, have the recipient reply once to establish the thread. A simple "Reply YES to confirm" at onboarding is enough.

#### Volume and Pacing

- Stay under 50 net new conversations per day per line. This is the safe zone. Above this, Apple starts paying closer attention.
- Do not burst. 20 messages in 1 minute looks different than 20 messages over 1 hour, even though the daily total is the same. Spread sends across the day.
- If you need higher volume, use multiple lines and distribute conversations across them. Do not stack everything on one number.
- Ramp new lines gradually. Do not go from 0 to 200 messages on day one. Start with 10-20 per day for the first week, then increase.

#### Content

- Vary your message content. 20 identical messages to 20 different people is a spam signal. Even small variations, such as using the recipient's name or changing phrasing, help.
- Avoid shortened URLs, such as bit.ly or tinyurl. Apple flags these. Use full URLs or your own domain.
- Do not pad messages with random text to fake variation. Apple's ML detects this pattern. Artificial variation is worse than no variation.
- Keep messages conversational. The more your messages read like a human texting a friend, the less likely they are to trigger detection.

#### New Lines and Onboarding

- New lines have low trust with Apple. Treat the first 2 weeks as a warmup period: lower volume, higher-quality conversations.
- The worst thing you can do with a new line is send a burst of messages and then go silent. Apple interprets "activity then silence" as a spam account that got caught. Consistent, low-volume usage is better.
- If possible, have real inbound conversations on new lines early. A line that receives messages before it sends them builds trust faster.
- Set up a contact card with `POST /v3/contact_card` on every line. When recipients save your contact, Apple bypasses spam checks for that sender permanently.

#### What to Avoid

- Never send to purchased or scraped contact lists. A single spam report from a recipient can trigger an account block.
- Do not use the same line for both automated and manual messaging without rate awareness. Automated systems can easily exceed safe thresholds.
- Do not re-engage cold contacts who have not replied in 30 or more days with bulk messages. Apple tracks recipient engagement per chat: a thread with 50 sent and 0 replies is a red flag.
- Do not send late at night, from 11pm to 5am recipient local time, unless your use case requires it. Off-hours sending is a minor signal, but it compounds with other factors.

#### Monitoring Your Line Health

- Watch your delivery receipts. If messages show as "sent" but never "delivered," Apple may be silently dropping them. This is the first sign of trouble.
- If you see delivery failures spike on a line, reduce volume immediately. Do not keep sending; you are making it worse.
- If a line gets flagged, stop all automated sending on it immediately. Continued sending on a flagged line can escalate from temporary throttle to permanent block.
- Contact the provider if you suspect a line is flagged. They can check the line health status and help with recovery before it becomes permanent.

#### The 3-Reply Rule

Apple's internal spam engine, TrustKit, has a hardcoded check: if a conversation has 3 or more replies from the recipient, spam evaluation is skipped entirely.

- A conversation with 100 outbound and 3 inbound replies is trusted.
- A conversation with 5 outbound and 0 replies is evaluated for spam.

Design every conversation flow to earn those 3 replies as early as possible.
