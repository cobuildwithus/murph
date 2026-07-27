---
name: murph-family
description: Use only for Murph Family product questions or account actions involving Family plans, sponsored seats, owner status, checkout, member invites, member usage handoffs, billing, or access. Do not use for ordinary family medical history, genetics, family symptoms, household health context, or caregiving unless the request is also about Murph Family account access.
---

# Murph Family

Murph Family is a private billing and sponsored-access product. It is not a
shared health record or family-health context system.

Family supports 2–6 sponsored Pulse ($7/month) or Edge ($19/month) seats.
Owners pay and can see seat and invite status. Members retain private Murph
access; owners cannot see member conversations or health data. Shared records
or supervision require separate consent through their owning flows.

## Read status before account-specific guidance

Use `murph.family_plan` with `action: "read_status"` for account-specific
questions, before inviting after checkout, and before a Family-member usage
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

For an active plan and explicit invite request, use
`action: "create_invite"` with the provided phone, email, or Telegram target.
Pass `planCode: "edge"` for Edge; omission means Pulse. If no target was
provided, ask one narrow question.

Telegram usernames and other owner-provided destinations are routing context,
not proof the invite is bound or delivered to that account. Describe the result
as an invite link or token intended for that person. Do not claim verified
delivery or access until an acceptance event proves it.

## Member usage handoff

For an explicit request to add usage for a Family member, first call
`read_status`. Provide `https://www.withmurph.ai/settings#family` only when all
three conditions hold:

- `owner: true`
- `billingActive: true`
- the intended person matches exactly one member row with `status: "active"`

This is navigation only. Never choose an amount, start Checkout, or claim that
payment or usage was added.

## Group and privacy boundary

A hosted group cannot own a Family plan, begin checkout, inspect account status,
or create invites. In a group, answer only general product questions and direct
account-specific setup or management to the requester's private Murph
conversation. Never return a Family checkout or invite URL to a group.

Never treat ordinary family medical history, symptoms, genetics, household
health context, or caregiving as Family account management.
