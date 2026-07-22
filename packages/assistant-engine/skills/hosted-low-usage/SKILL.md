---
name: hosted-low-usage
description: Use when trusted hosted turn context says Murph usage is running low, or when a user follows up on that warning and asks how to keep a direct trial, paid plan, Family-sponsored Murph, or hosted group conversation going.
---

# Hosted low usage

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

For this first heads-up, ignore `usedPercent`, `remainingPercent`, `forecast`,
the recommendation URL, and subscription quote price even when the tool
returns them. Do not render a link or Markdown link. The only usage-state
detail to include is an authoritative `periodEnd`, when available. Ask about
the one supported next step in plain language. Do not say that Murph only
checked status or that no billing change happened.

## Read the right state

- On an eligible private direct heads-up after the output gate above, call
  `murph.plan_usage` once when available. This is the allowed manual private
  check, not a watcher. Use its access kind, plan, period end, and
  `recommendedAction` to choose the scenario; reserve percentages and forecast
  for an explicit numerical usage follow-up. Do not infer missing facts.
- In a group, do not call `murph.plan_usage`. The trusted low bit is enough for
  the first heads-up. Call `murph.group action="read_usage"` only after the
  group asks about its usage or how to add more.
- If the relevant read fails or is unavailable, keep the heads-up generic. Do
  not guess the plan, reset date, action, price, or funding link.

## Choose the first-heads-up question

When the output gate above permits an assistant-initiated heads-up, finish the
user's current request first. Then append exactly one final usage segment,
using `---` only on a bubble-supporting channel. Follow the mandatory output
contract above.

Say only that Murph may pause if usage runs out. Name the reset or trial-end
date only when the authoritative read returned `periodEnd`; prefer that date to
percentages or a days-remaining forecast. Do not volunteer percentages, price,
links, internal accounting, payer or contributor identity, or the disclaimer
that no billing change happened.

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
- **Hosted group:** Say the group's Murph time may pause and ask whether the
  group wants Murph to check how it can add more usage. Do not promise a link
  before the group read returns one, and do not name or nominate a payer.
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
Quick heads-up: this group's Murph time may pause if usage runs out. Want me to check how the group can add more?
```

Adapt the wording to the conversation. Do not reuse either example as a fixed
template.

## Follow-up options

When the user asks what to do, read current state again if the answer requires
it and give the smallest useful comparison:

For any Family usage or tier management follow-up, first call
`murph.family_plan action="read_status"` when available. Offer the private
Family Settings handoff only after an explicit owner request and only when the
current result has `owner: true`, `billingActive: true`, and the intended person
matches exactly one `members` row whose `status` is `active`. Ask one narrow
clarifying question when the intended member is missing or ambiguous. When any
gate fails, do not provide the handoff: explain that the active Family owner
must manage an active member. The handoff is navigation to Settings > Family,
not permission to choose an amount, start Checkout, or claim usage was added.

- **Trial:** Starting Pulse now can preserve continuity. State the exact current
  `subscriptionActionQuote` label before asking for confirmation. Waiting for
  the trial end or usage reset remains a valid choice.
- **Paid Pulse:** A one-time usage-credit addition fits a temporary spike. If
  the member explicitly asks about a lasting alternative and a current
  `upgrade_edge` quote exists, explain that Edge fits a consistently higher
  pace. Never present the quote itself as a recommendation.
- **Paid Edge:** Offer the authorized one-time add-usage handoff or waiting for
  the reset. There is no higher current direct tier to invent.
- **Family Pulse:** Personal top-ups are unavailable. The Family plan owner may
  add one-time usage for this active member or move the member's seat to Edge
  after the shared Family management gate above. Do not send a sponsored
  non-owner to personal Settings or claim a change happened.
- **Family Edge:** Personal top-ups and a higher Family tier are unavailable.
  The Family plan owner may add one-time usage for this active member after the
  shared Family management gate above. Otherwise offer to use less included
  usage or wait for the reset.
- **Group:** After an explicit request, call `read_usage`. Share only its
  returned coarse state, period end when relevant, and first-party funding URL.
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
  handoff. Never choose an amount, start Checkout, or claim usage was added.
- Send a group funding URL only after the group asks and `read_usage` returns
  it.
- Keep the tone calm and lightly persuasive through continuity: "keep going"
  or "keep us moving" is fine. Never plead, guilt, dramatize, invent urgency,
  or imply Murph will die.
- Do not repeat the heads-up when it already appears in the recent
  conversation.
