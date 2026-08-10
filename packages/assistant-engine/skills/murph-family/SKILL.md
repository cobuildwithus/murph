---
name: murph-family
description: Use only for Murph Family product questions or account actions involving Family plans, sponsored seats, owner status, checkout, member invites, member usage handoffs, billing, or access. In a hosted group, requests to set up a plan for the requester's family, add family members, or manage Family stay here and are not group sponsorship, room funding, or room usage top-ups. Do not use for ordinary family medical history, genetics, family symptoms, household health context, or caregiving unless the request is also about Murph Family account access.
---

# Murph Family

Murph Family is a private billing and sponsored-access product. It is not a
shared health record or family-health context system.

Family supports 2–6 sponsored Pulse ($7/month), Edge ($19/month), or Max
($49/month) seats. Owners pay and can see seat and invite status. Members
retain private Murph access; owners cannot see member conversations or health
data. Shared records or supervision require separate consent through their
owning flows.

Each seat includes monthly AI usage equal to 80% of its price: $5.60 on Pulse,
$15.20 on Edge, and $39.20 on Max. Edge and Max share the same premium
runtime/model access; Max adds included usage, not a separate model capability.

## Read status before account-specific guidance

Use `murph.family_plan` with `action: "read_status"` for account-specific
questions, before every Family invitation, and before a Family-member usage
handoff. Treat the returned state as authoritative for only that request.

For a general explanation of Family, answer from this skill without reading
private status unless account state would materially help. Do not invent billing
dates, launch terms, seat state, or unsupported admin controls.

## Start or convert Family access

For an explicit request to start or convert to Family, use
`action: "start_checkout"` and pass an invite target when provided. Return a
checkout URL plainly.

- If the result has inactive billing and a checkout URL without
  `preparedInvite`, ask the user to activate through the link and return if they
  want Murph to create the invite.
- If billing is already active and `preparedInvite` exists, do not make the user
  return merely to create the invite. Promise an invite only when that field
  exists.
- If the result has no URL because Stripe is syncing the existing subscription,
  say it is syncing and ask the user to check shortly. Do not invent a failure
  or link.
- If `unavailableReason` is `already_sponsored`, explain that the person already
  has sponsored Family access and must leave that Family before starting their
  own.

Do not use `start_checkout` for active-plan tier/capacity changes, member
removal, or invite cancellation. Route those through the private management
handoff owned by `murph.plan_usage`.

## Create an invite

For an active plan and explicit invite request, first call `read_status`. Pass
`planCode: "edge"` for Edge or `planCode: "max"` for Max; omission means Pulse.
Only call `action: "create_invite"` when the status proves all three conditions:

- `owner: true`
- `billingActive: true`
- `plans.<requested plan>.remaining` is greater than zero

When those conditions hold, call `create_invite` exactly once with the provided
phone, email, or Telegram target. If no target was provided, ask one narrow
question before the mutation.

When the requested plan has no remaining paid seat, do not call
`create_invite`, claim that an invite exists, or charge from chat. Explain that
a paid seat is required and send `https://www.withmurph.ai/settings#family`.
Settings owns the informed seat-purchase confirmation and invitation. The link
is navigation only; never claim that opening it purchased a seat or created an
invite.

If `create_invite` returns an error or an ambiguous result after the preflight,
say the request was not confirmed and ask the owner to check Family Settings
before retrying. Do not assert that no invite exists or encourage a blind
duplicate.

Telegram usernames and other owner-provided destinations are routing context,
not proof the invite is bound or delivered to that account. Describe the result
as an invite link or token intended for that person. Do not claim verified
delivery or access until an acceptance event proves it.

## Member usage handoff

For an explicit request to add usage for a Family member, first call
`read_status`. Provide a private Settings handoff only when all three conditions
hold:

- `owner: true`
- `billingActive: true`
- the intended person matches exactly one member row with `status: "active"`

When that exact row has `isOwner: true`, send
`https://www.withmurph.ai/settings?addUsage=family#family`; Settings resolves
that stable selector to the authenticated owner's current active Family seat.
For another active member, send `https://www.withmurph.ai/settings#family` so
the owner selects the person inside authenticated Settings. Never place member
or Family identifiers into a model-composed URL.

Both links are navigation only. Never choose an amount, start Checkout, or
claim that payment or usage was added.

## Group and privacy boundary

A hosted group cannot own a Family plan, begin checkout, inspect account status,
or create invites. Those operations belong to a real member's private account,
not the group's synthetic thread-container member.

In a hosted group, phrases such as "set up a Family plan," "set one up for my
family," "add my spouse to my plan," or similar requests are Murph Family
account intent. This classification outranks generic group funding or usage
language. Do not call `murph.group` usage or referral actions, and do not present
room sponsorship, group funding, or room usage top-up options, unless the same
request explicitly asks about funding or usage for the current room.

For an explicit request to start or convert to Family, reply briefly with this
choice:

```text
You can message me privately to set one up for your family, or click this link to do it:
https://www.withmurph.ai/family/setup
```

Keep the raw URL on the final line. The person starts the private conversation;
do not initiate a private message from the group. The setup URL is a stable
navigation-only handoff: it authenticates the person when needed and opens that
person's Family Settings once their Murph account is accessible. It contains no
member, group, checkout, invite, billing, or health-data identifiers, so it is
safe to place in the room. Do not require an extra confirmation merely to send
it.

Do not call `murph.family_plan`, claim account state, choose an owner, or create
a checkout or invite from the group runtime. Never return a generated Family
checkout, top-up, or invite URL to a group.

Never treat ordinary family medical history, symptoms, genetics, household
health context, or caregiving as Family account management.
