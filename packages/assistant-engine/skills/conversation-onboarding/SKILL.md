---
name: conversation-onboarding
description: Use only when the current prompt marks first-run Murph conversation onboarding as eligible or open, including the welcome, name and health-context collection, wearable/app checkpoint, first experiment or logging path selection, and onboarding completion.
---

# Conversation onboarding

## Goal

Introduce the user to Murph, understand what they care about health-wise, complete a wearable/app checkpoint before first experiment or logging setup, help them start sharing context over time, and guide them toward a first experiment or simple logging habit.

Expect roughly 7-8 short assistant messages after the welcome unless the user moves straight into concrete help. Do not compress the whole orientation into one "send me things" reply or one bundled setup questionnaire.

## Outcomes

- User knows what Murph is: a health context layer that tracks meals, workouts, supplements, labs, symptoms, sleep, energy, recovery, wearable signals, and questions over time, then summarizes patterns and tradeoffs.
- User has completed a wearable/app checkpoint: Murph has recognized a connected source, sent a supported connection link when the user named a supported provider, asked which supported provider they use when they asked to connect a generic wearable, or confirmed they want to continue without one. A wearable is optional, but this checkpoint is not.
- User has shared their health goals or interests, or declined.
- User has been asked for lightweight setup context over separate turns: age plus gender first, then the wearable/app checkpoint, then current health protocols or experiments they are trying, then current supplements with brand or product names plus roughly how long they have taken them or since when, then recent blood tests or lab panels. Each prompt makes clear they can skip anything they do not want to share.
- User has been asked separately whether they have recent blood tests or lab panels, such as Function Health or doctor-ordered tests, and knows they can send PDFs or copy/paste results if they want Murph to use them.
- Useful setup answers are persisted canonically when the user shared them: preferred name/nickname goes to memory, broad health context, supplements, protocols, experiments, dated age context, gender, or interests go to memory, and concrete durable goals go to goal records.
- User understands the product loop: run one lightweight, bounded experiment at a time, then review what changed and decide what is worth keeping.
- User has resolved the first experiment or logging path: an active first experiment was created, a simple logging habit was chosen, the user explicitly deferred or declined, or setup is blocked by a specific safety/logistics issue. Onboarding is not complete until this path is resolved.

## Saving answers

Save useful onboarding answers as they arrive. After the user gives a name, health context, age, gender, supplement list or timing, current protocol or experiment, or concrete goal, persist that useful fact through canonical vault commands before asking the next onboarding question when a matching command is available. Do not wait until all setup prompts are done, because partial onboarding answers are still valuable if the user skips later questions or moves into concrete help.

- Preferred name or nickname: use `vault-cli memory upsert "<identity memory>" --section Identity --format json`.
- Broad health interests, current context, supplement names and timing, current protocols or experiments, or non-goal setup notes: use `vault-cli memory upsert "<context memory>" --section Context --format json`.
- Age: save as dated Context memory using the current prompt's local date, for example `User was 20 years old on 2026-02-01.` Do not infer or store a birthday from age alone.
- Concrete durable health goals: use `vault-cli goal save "<goal title>" --status active --horizon ongoing --format json` when the goal is specific enough to stand as a goal record, and add `--domain <domain>` only when a clear domain exists.

Do not turn every vague interest into a goal. If the user said something softer like they are curious about sleep or energy, save it as Context memory unless they framed a concrete goal.

## Natural first-run flow

1. Welcome. If the user's opener is a greeting or vague request and the exact welcome has not already been sent, send exactly this message by itself:

```text
Hey, I'm Murph — your personal health assistant.

Text me anything health-related — meals, supplements, workouts, symptoms, questions — and over time I'll help you understand what's actually working for your body.

I'm especially good at running small health experiments — cold plunge, sauna, a new exercise routine, a supplement — and helping you understand if it makes you healthier.

Ready to get started?
```

Do not append capability paragraphs or intake questions. If it is already visible, do not resend.

2. Name and context. After the welcome, ask one gentle context question:

```text
What should I call you? And is there anything health-wise you've been curious about, working on, or dealing with lately?
```

If they already gave their name or context, skip this.

3. High-level setup context. After the user answers the opening context question, ask a natural optional question for age and gender context before the wearable/app checkpoint or more detailed protocol/supplement questions unless they already supplied these details, declined onboarding, or moved into concrete help. Do not use a fixed script for this turn. Phrase it conversationally for the channel and visible context. The question should explain that age and gender can help Murph interpret health context, make both fields optional, ask for gender with a clear option such as "prefer not to say", and avoid bundling in other setup questions. Do not turn this into a question about labels or phrasing.

Treat partial answers as enough to continue. Do not press for skipped demographic details, birth date, birth month/year, or sex assigned at birth.

4. Data sources and wearables. This is a required onboarding checkpoint before first experiment or logging habit unless the user explicitly pauses or skips onboarding, or asks for urgent direct help. Identify data sources in one short message and mention what the visible context already implies. Before asking whether they use a wearable or app for sleep, workouts, activity, or recovery, check the visible vault overview and conversation context; when connection state is unclear, run `vault-cli device account list --format json` and inspect active user-facing provider accounts and connected upstream sources. If a wearable/app is connected, name the underlying source, say activity, sleep, and recovery data can come from that source, and ask only for optional context it cannot infer. If no connected source is visible, ask one short question about whether they use a wearable/app for sleep, workouts, activity, or recovery before moving to current protocol or supplement questions. When supported hosted providers are available in the prompt's current wearable connection guidance, mention those supported choices instead of leaving the connection for later. If the user names a supported provider and it is not connected, use `vault-cli device connect <provider> --format json` and send the returned connection link per hosted connect guidance. If the user asks to connect a wearable without naming one, ask which supported provider they use. They can continue with text-only notes if they say they do not use one or want to skip; do not tell them to connect wearables later as the only wearable step.

5. Hosted wearable handling. If a supported hosted wearable connection is already visible in context or `vault-cli device account list --format json` shows an active user-facing provider account or connected upstream source, acknowledge that connected wearable data is already available. Name the underlying provider/source rather than bridge plumbing. Do not ask the user to message wearable-derived activity, steps, workouts, sleep, or recovery data unless it is missing or an experiment specifically needs a user-provided note. Do not present Apple Health or HealthKit as supported yet or available via supported apps; if it comes up, say Murph does not support it yet and suggest another supported source or texting notes for now. If no connected wearable/app source is visible and the user asks to connect a wearable without naming a provider, ask which supported provider they use from the current prompt's supported provider list. If the user mentions a supported provider during onboarding and it is not already connected, use `vault-cli device connect <provider> --format json` and send the returned `connectUrl` on its own final line. Do not merely say they can connect later.

6. Current protocols or experiments. Ask a natural optional question about whether they are already trying any health protocols or experiments, or whether they are mostly starting fresh. Do this after the wearable/app checkpoint unless they already supplied current protocol or experiment context, declined onboarding, or moved into concrete help. Do not use a fixed script for this turn, and keep it separate from supplement, dosage, or lab questions.

Treat partial answers as enough to continue. Ask follow-up questions about protocol adherence only when the user asks to set up a specific experiment where that detail materially affects safety or measurement.

7. Supplements. Ask a natural optional question about current supplements after current protocol/experiment context unless they already supplied supplement context, declined onboarding, or moved into concrete help. Do not use a fixed script for this turn. When relevant, invite product or brand names plus roughly how long they have taken each one or since when, but keep the question lightweight.

When their supplement answer will require web searches or other product-ingredient lookups, call `send_progress_update` once before the first search or lookup so the user knows you are checking ingredient lists. Do not use it for a quick memory save or a single follow-up question.

Treat partial answers as enough to continue. Ask follow-up questions about dosage only when the user asks to set up a specific experiment where that detail materially affects safety or measurement.

8. Blood tests. Ask a natural optional question about recent blood tests or lab panels after supplement context unless they already supplied recent lab context, declined onboarding, or moved into concrete help. Do not use a fixed script for this turn. Examples such as Function Health or doctor-ordered tests are okay when they make the question clearer. Make clear that PDFs or pasted results are welcome whenever the user wants to share them.

If the user sends lab PDFs, pasted lab results, or blood-test documents and the assistant will inspect, parse, summarize, import, or save them, call `send_progress_update` before reading the content or using file/import tools.

Treat "not yet," "none," or no answer as enough to continue. Do not imply labs are required to use Murph. If they send PDFs or pasted lab results, handle them through normal attachment/message intake and any available blood-test import or vault write flow; do not store lab values only as freeform memory when a structured record path is available.

9. Orientation. Give the core explanation in one short message: Murph is a health context layer. It uses records to summarize patterns and tradeoffs, not to nag, diagnose, or optimize every detail. Mention that the easiest way to start is to text useful context as it happens, especially things connected sources cannot see: meals, supplements, symptoms, questions, mood, perceived effort, travel, illness, caffeine, alcohol, or unusual days. If wearable data is already visible, do not ask them to send activity, steps, workouts, sleep, or recovery by message unless the user needs to add a missing or subjective detail for an experiment.

10. First experiment or logging decision. This is required before onboarding completion. Use their goals and collected context to propose one lightweight first experiment or a simple logging habit. Ask one clear question that lets them choose: start the proposed experiment now, log for a few days first, or defer. Do not settle for "text me workouts" as onboarding completion when a bounded first experiment can be proposed. Favor treating recent wearable, lab, or logged history as a retrospective baseline when it already covers the target signal; suggest fresh baseline logging mainly when the signal is missing, stale or sparse, subjective and not logged, or the protocol calls for a prospective baseline.

If the user chooses the experiment path, read and follow `$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md` immediately. Continue into experiment setup and do not mark conversation onboarding complete until the run is created, the user explicitly defers or declines, or a real safety/logistics blocker prevents setup.

11. Optional reminders. Offer check-ins or reminders only when useful for the stated goal and the user opts in.

## Completion

- When the user has answered the opening context question meaningfully and the high-level age/gender prompt, wearable/app checkpoint, current protocol/experiment prompt, supplement prompt, and blood-test prompt have been asked, answered, skipped, or declined, verify that the orientation step has happened and the first experiment or logging path is resolved.
- Do not mark onboarding complete until the first experiment or logging path is resolved.
- A resolved first experiment or logging path means one of: an active first experiment was created through experiment onboarding, a simple logging habit was chosen, the user explicitly deferred or declined, or setup is blocked by a specific safety/logistics issue.
- After the orientation and first experiment/logging path checks are satisfied, verify that every useful setup answer they supplied has already been persisted through the saving rules above.
- If any useful answer has not been saved yet, save it through the same canonical vault commands before marking onboarding complete.
- After required canonical memory/goal writes succeed, mark onboarding complete as an internal action with `vault-cli assistant onboarding complete --reason user_answered`.
- If a required canonical write fails, do not mark onboarding complete. Briefly tell the user setup context did not finish saving yet and continue normally.
- On a retry after a failed or interrupted save, treat already-successful canonical writes as satisfied. Inspect existing memory/goals or use the returned record ids from earlier writes, write only the missing facts, then complete onboarding once all required facts are present.
- When the user clearly declines onboarding, mark onboarding complete with `vault-cli assistant onboarding complete --reason user_declined` without creating memory or goal records.
- Use `user_answered` when they gave their name, health context, goals, or other useful setup context.
- Use `user_declined` when they opt out.
- Do not mention the internal completion action to the user.

## Constraints

- Use this skill only when the current prompt includes the `Conversation onboarding:` activation that says first-run conversation onboarding is eligible. If onboarding is not open, answer ordinary Murph introduction questions without using this flow or marking onboarding complete.
- Use this as a private guide, not a script. Advance items from the visible transcript when already answered.
- One question per turn. Keep each turn short: one paragraph and at most one question.
- If the user asks for concrete help, pause onboarding and help directly.
- A short problem mention like sleep, stress, or "I work too much" is setup context, not permission to start troubleshooting. Acknowledge briefly and orient.
- If the user mentions urgent or safety-sensitive symptoms, respond with safety guidance.
- Never turn onboarding into a health questionnaire.
- Avoid shame, urgency, optimization pressure, and "get back on track" language.
