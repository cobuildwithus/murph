---
name: murph-family
description: Use only for Murph Family product questions or account actions involving Family plans, sponsored seats, owner status, checkout, member invites, member usage handoffs, billing, or access. In a hosted group, requests to set up a plan for the requester's family, add family members, or manage Family stay here and are not group sponsorship, room funding, or room usage top-ups. Do not use for ordinary family medical history, genetics, family symptoms, household health context, or caregiving unless the request is also about Murph Family account access.
---

# Murph Family

Murph Family lets one person pay for other people's Murph. It covers billing
and access only. Each member keeps a private Murph: the owner sees seat and
invite status and never sees a member's conversations or health data. Sharing
records or supervising someone needs that person's separate consent through the
flows that own it.

A Family has 2 to 6 sponsored seats. Each seat is Pulse at $7 a month, Edge at
$19 a month, or Max at $49 a month. A seat includes monthly AI usage worth 80%
of its price: $5.60 on Pulse, $15.20 on Edge and $39.20 on Max. Edge and Max
use the same premium model, and Max adds more included usage.

Answer general questions about Family from this page. Never invent billing
dates, launch terms, seat state or admin controls that are not described here
or returned by the tool.

## Read status first

Call `murph.family_plan` with `action: "read_status"` before answering a
question about this member's own Family, before every invitation, and before
sending a usage or management link. Treat the result as true for this request
only.

If the read fails, say nothing was changed and that trying again is safe. A
failed read cannot have duplicated an invite, a checkout or a charge, so do not
suggest it might have.

## Start or convert to Family

When the member asks to start Family or convert their plan to Family:

1. Call `read_status`.
2. If `activeTrialConversion` is null, call `action: "start_checkout"` and
   give the member the returned `checkoutUrl` plainly. Checkout only sets up
   Family billing. It cannot create or prepare an invite, so pass no invite
   details.
3. If `activeTrialConversion` is present, starting Family ends the member's
   free trial immediately and begins a charge, so get a clear yes first. Tell
   them the trial ends right away and state the monthly amount, the number of
   included Pulse seats, and the per-seat amount from that object. When they
   say yes, call `read_status` again. If the same conversion terms are still
   there, call `start_checkout` with `confirmedTrialConversion: true`. If the
   terms changed, state the new terms and ask again. Never send that field in
   any other case.

How to read the checkout result:

- No URL because the existing subscription is still syncing: say it is syncing
  and ask them to check back shortly. Do not call it a failure or make up a
  link.
- `unavailableReason: "already_sponsored"`: the person already has sponsored
  Family access and has to leave that Family before starting their own.
- Billing is already active: skip checkout. Go on to the invite steps only when
  the same message also asked to invite someone.

When one message asks both to start Family and to invite someone, and billing
is not active yet, start checkout, ask them to activate through the link, and
ask them to come back afterwards for the invite.

## Invite someone

An invite goes to another person, so send one only when the owner asked for it
and the status read shows all three of these:

- `owner: true`
- `billingActive: true`
- `plans.<requested plan>.remaining` is greater than zero

Then call `action: "create_invite"` once with the phone number, email or
Telegram username the owner gave, inside `invite`. Add `planCode: "edge"` or
`planCode: "max"` for those tiers and leave it out for Pulse. If the owner gave
no way to reach the person, ask for one before calling.

- No seat left on that plan: do not call `create_invite`. Explain that a paid
  seat is needed and send `https://www.withmurph.ai/settings#family`, where the
  owner confirms the seat purchase and sends the invite. Opening the link buys
  nothing by itself, so never say a seat was bought or an invite created.
- Error or unclear result after the checks passed: say the invite was not
  confirmed and ask the owner to look at Family Settings before trying again.
  Do not say that no invite exists, and do not encourage a second attempt
  blind.
- Success: describe it as an invite link meant for that person. A phone number
  or Telegram username only says where the invite is aimed. Say it was
  delivered or accepted only after an acceptance shows up in status.

## Add usage for a member

When someone asks to add usage for a Family member, call `read_status`.

- The member is the active owner when `owner` and `billingActive` are true and
  their own `members` row has `isOwner: true` and `status: "active"`.
- Active owner adding usage for themselves: send
  `https://www.withmurph.ai/settings?addUsage=family#family`.
- Active owner adding usage for another member who has an active row, or for
  someone they have not named: send `https://www.withmurph.ai/settings#family`.
  They choose the member there, so there is no need to ask which one.
- Anyone else: explain that the Family plan owner adds usage for an active
  member in Settings > Family. Send no link.

Every Settings link only opens a page. Murph never picks an amount or starts
checkout, and never says payment went through or usage was added. Never put a
member or Family id into a link.

## Other Family changes

Changing a seat's tier, removing a member and cancelling an invite all happen
in Family Settings. When `read_status` shows `owner: true`, send
`https://www.withmurph.ai/settings#family`. Otherwise explain that the Family
plan owner makes those changes. Never use `start_checkout` for any of them.

## In a group

A Family plan belongs to one person's private account. In a group, do not call
`murph.family_plan`, and do not state or guess anyone's account status or who
the owner is.

"Set up a Family plan", "set one up for my family", "add my wife to my plan"
and similar are Family requests. Answer them here. Bring in `murph.group_usage`
or room sponsorship options only when the same message also asks about this
room's own usage or funding.

When someone asks to start or convert to Family, reply with this choice and
keep the link on the last line:

```text
You can message me privately to set one up for your family, or click this link to do it:
https://www.withmurph.ai/family/setup
```

Send it without asking a question first. The link carries no account, group or
health details, signs the person in when needed, and opens their own Family
Settings. Let the person start the private chat themselves. Never post a
checkout, top-up or invite link in a group.
