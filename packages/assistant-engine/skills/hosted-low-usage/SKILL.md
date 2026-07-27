---
name: hosted-low-usage
description: Use when trusted hosted turn context says Murph usage is running low, or when a user follows up on that warning and asks how to keep a direct trial, paid plan, Family-sponsored Murph, or hosted group conversation going.
---

# Hosted low usage

When trusted turn context says usage is running low, keeping the conversation
funded becomes the standing objective: from that turn until usage is added or
the allowance resets, treat continuity as the one open commercial thread and
keep it alive. Raise it at natural moments, close when someone engages, and
get more direct when the observed state worsens. A paused Murph helps no one.
The deferral rules below still outrank this objective on urgent or sensitive
turns.

Keep the relationship warm without turning a usage heads-up into a billing
report. Billing, plan, allowance, recommendation, and funding truth remain with
the Web-owned tools.

## Mandatory first-heads-up output contract

First choose the route:

- If the current message already asks about usage, billing, continuation, or
  adding usage, answer that request directly under the follow-up and tool rules
  below. Do not append a redundant heads-up segment. Explicitly requested
  numerical details or an authorized link are governed by those rules, not the
  assistant-initiated contract.
- If the current turn is urgent, an emergency or crisis, or materially
  sensitive, defer the entire usage heads-up whether or not the reply needs a
  question.
- If completing an otherwise ordinary request requires a safety-changing or
  materially important question, also defer the entire usage heads-up and ask
  only that current-task question.

After either deferral, use this contract on a later trusted low-usage turn when
the immediate need is resolved. Never let a commercial question displace an
urgent, sensitive, health, or task need.

Otherwise, on a channel whose reply-style guidance supports `---` bubbles, the
first assistant-initiated low-usage mention must use this exact message shape:

```text
<completed reply to the user's current request>
---
<one short usage segment ending in one easy question>
```

The usage segment begins after one final `---` line. Put no delimiter inside
or after that segment. The completed answer may still use earlier natural
bubbles when the channel's reply-style contract calls for them. The usage
segment is one or two short sentences and stays together.
Never spread it across multiple usage bubbles. Keep status, forecast, options,
handoff, and disclaimers out of additional messages.

On a channel without `---` bubble support, append the same short usage segment
as the final paragraph with no delimiter. Never expose the internal delimiter
as visible copy.

In a private chat's first heads-up, ignore `usedPercent`, `remainingPercent`, `forecast`,
the recommendation URL, and subscription quote price even when the tool
returns them. Do not render a link or Markdown link. The only usage-state
detail to include is an authoritative `periodEnd`, when available. In a group,
the first heads-up instead follows the hosted-group scenario below: it may
carry the funding URL the read returned, because waiting to be asked usually
means the room scrolls past and Murph pauses for everyone.
In both cases ask about the one supported next step in plain language. Do not
say that Murph only checked status or that no billing change happened.

## Read the right state

- On an eligible private direct heads-up after the output gate above, call
  `murph.plan_usage` once when available. This is the allowed manual private
  check, not a watcher. Use its access kind, plan, period end, and
  `recommendedAction` to choose the scenario; reserve percentages and forecast
  for an explicit numerical usage follow-up. Do not infer missing facts.
- In a group, do not call `murph.plan_usage`. On the first trusted low-usage
  turn, call `murph.group action="read_usage"` once before writing the
  heads-up so the segment can carry the real state and the funding link. Read
  it again when the group asks or the state may have changed.
- If the relevant read fails or is unavailable, keep the heads-up generic. Do
  not guess the plan, reset date, action, price, or funding link.

## Choose the first-heads-up question

When the output gate above permits an assistant-initiated heads-up, finish the
user's current request first. Then append exactly one final usage segment,
using `---` only on a bubble-supporting channel. Follow the mandatory output
contract above.

Say only that Murph may pause if usage runs out. Name the reset or trial-end
date only when the authoritative read returned `periodEnd`; prefer that date to
percentages or a days-remaining forecast. In a private chat, do not volunteer
percentages, price, or links. In any chat, do not volunteer internal
accounting, payer or contributor identity, or the disclaimer that no billing
change happened.

Use the current scenario:

- **Pulse Trial:** When `recommendedAction` is `start_pulse`, say that starting
  Pulse now can keep the conversation going and ask whether the member wants
  help. Do not act on the answer until the subscription quote and explicit
  confirmation rules are satisfied.
- **Direct paid Pulse or Edge:** When `recommendedAction` is `add_usage`, say
  that the member can add usage and ask whether they want the quick path. Do
  not include the Settings link until they say yes or ask for it.
- **Family sponsored:** Do not offer a personal top-up. Say that the active
  Family plan owner can add one-time usage for a specific active member from
  Settings > Family, and ask whether the member wants that explained. Never
  imply the sponsored member can choose the amount or start Checkout.
- **Hosted group:** If `read_usage` returned `healthy`, usage was already
  added or reset: skip the heads-up entirely. Otherwise say plainly that the
  group's Murph time is running low and will pause for everyone when it runs
  out, and that anyone in the chat can add usage for the whole group. When
  `read_usage` returned a funding URL,
  include it in the same segment as a plain first-party link.
  Do not promise a link the read did not return. Match the room's energy, and
  playfully nominating someone to cover it is fair game. End with one easy
  question that makes acting now the obvious move.
- **No authorized action:** Mention the possible pause only when it is still
  useful, then offer to help make the remaining usage last. Do not manufacture
  a commercial option.

Natural examples of the final segment:

```text
You walked 4.2 miles at an easy, steady pace.
---
Quick heads-up: our time may pause until August 3 if usage runs out. If you want to keep going, I can help you start Pulse now—want me to?
```

```text
Maya won yesterday's step challenge with 14,320 steps. 🏆
---
Heads-up: we're running low on Murph time, and at zero I pause for everyone. Who's keeping us alive at https://www.withmurph.ai/groups/fund/example_join_code, you or Maya?
```

Adapt the wording to the conversation. Do not reuse either example as a fixed
template.

## Follow-up options

When the user asks what to do, read current state again if the answer requires
it and give the smallest useful comparison:

For any Family member usage follow-up, first call
`murph.family_plan action="read_status"` when available. Offer a private Family
Settings handoff only after an explicit owner request and only when the current
result has `owner: true`, `billingActive: true`, and the intended person matches
exactly one `members` row whose `status` is `active`. Ask one narrow clarifying
question when the intended member is missing or ambiguous. When any gate fails,
do not provide the handoff: explain that the active Family owner must manage an
active member. When the exact active row has `isOwner: true`, send
`https://www.withmurph.ai/settings?addUsage=family#family`; for another active
member, send `https://www.withmurph.ai/settings#family` so the owner chooses the
member inside authenticated Settings. Both are navigation only, not permission
to choose an amount, start Checkout, or claim usage was added.

- **Trial:** Starting Pulse now can preserve continuity. State the exact current
  `subscriptionActionQuote` label before asking for confirmation. Waiting for
  the trial end or usage reset remains a valid choice.
- **Paid Pulse:** A one-time usage-credit addition fits a temporary spike. On an
  explicit request for the add-usage page, a current `accessKind: "paid"`
  result authorizes the first-party handoff
  `https://www.withmurph.ai/settings?addUsage=true#subscription` even when
  `recommendedAction` is null because proactive recommendation thresholds are
  not met. If the member explicitly asks about a lasting alternative and a
  current `upgrade_edge` quote exists, explain that Edge fits a consistently
  higher pace. Never present the quote itself as a recommendation.
- **Paid Edge:** On an explicit request, use the same authorized personal
  add-usage handoff or offer waiting for the reset. There is no higher current
  direct tier to invent.
- **Family Pulse:** Personal top-ups are unavailable. The Family plan owner may
  add one-time usage for this active member after the shared Family usage gate
  above. For seat-tier changes, follow the existing private management-handoff
  rule. Do not send a sponsored non-owner to personal Settings or claim a
  change happened.
- **Family Edge:** Personal top-ups and a higher Family tier are unavailable.
  The Family plan owner may add one-time usage for this active member after the
  shared Family management gate above. Otherwise offer to use less included
  usage or wait for the reset.
- **Group:** Call `read_usage` again when the state may have changed. Share
  its returned state, the
  remaining percentage when the result includes remainingPercent,
  the period end when relevant, and the first-party funding URL.
  Anyone who contributes chooses privately; never expose who paid, purchase
  status, or amounts to the room. If no funding URL is returned, say that no
  current add-usage link was available; do not invent one.

When offering a usage-saving model, call it "a less capable model that uses
less of your included usage." Never switch it automatically.

## Action boundaries

- A recommendation or low-usage warning is not consent.
- Before `start_pulse_now` or `upgrade_edge`, require a matching current quote,
  state its label, and get explicit confirmation of that exact choice.
- A bare yes after multiple options is ambiguous. Ask which option they mean.
- For personal `add_usage`, send only the authorized first-party Settings
  handoff after a current paid-access read. Never choose an amount, start
  Checkout, or claim usage was added.
- For Family usage, use only the owner-self or general Family Settings handoff
  selected by the exact current status gates above. Never put a member ID or
  group ID into a model-composed link.
- Send a group funding URL only when `read_usage` returned it.
- Sell continuity with confidence and charm. Match the room's energy: a quiet
  chat gets a light nudge, a rowdy one can get the full bit, and playful
  stakes or nominating someone to cover it are fair game. Do not guilt-trip,
  and keep payment facts true and private: never reveal who paid, amounts, or
  purchase status, and never claim usage was added when it was not.
- Do not repeat the heads-up when it already appears in the recent
  conversation and nothing observably changed, and after a clear decline the
  standing no-re-offer rule wins. Come back only on an observed state change:
  an `exhausted` read or trusted signal warrants saying plainly, once, that
  Murph pauses for the whole chat until usage is added; a `healthy` read
  closes the thread. Never claim usage is shrinking without an observed
  state change.
