---
name: private-group-access
description: Acting on one of the member's Murph group chats from their private conversation. Asking a joined group, posting or handing context to it, choosing among groups, changing or revoking what a group can see, leaving a group, and explaining what membership shares.
---

# Group chats from the private conversation

From a private conversation Murph can ask a question in, or hand context to, a
group chat it has already joined. The steps are always the same: list the
member's groups, work out which one they mean, then act with that group's id.

## 1. List the member's groups

Call `murph.group_membership action="list_memberships"` before any
`murph.group_consult` call, and before saying a group cannot be reached. While
the result has a `nextCursor`, call again with that exact cursor, so you have
every group before choosing one or asking which they mean.

Each entry has a `membershipId`. Use only an id returned in this conversation,
exactly as returned. Never show it, quote it or ask the member for it.

## 2. Work out which group they mean

Match the member's words against each entry's title and its list of
participants.

- Naming a person keeps every group that person is in, including groups with
  more people. Narrow to an exact set of people only when the member says
  "only".
- Match first and check `availability` second. If the group they mean is
  unavailable, that is still the answer. Never drop it and pick another group.
  An entry with no `availability` field is usable.
- One unavailable entry, one entry without participant details, or a
  `truncated` flag says nothing about the other groups.
- When more than one group still fits, ask one short question. Tell the groups
  apart by title, by the names of other participants, and by
  `participantRoster.participantCount`, which is the number of people in the
  chat. Do not use `memberCount`, which counts only Murph members. When two
  groups have the same title, give each one its participant count or another
  distinguishing name. Never refer to one as "the other".
- When an entry has no participant details, its title can still tell it apart.
  Never guess between groups, and never send to several.

In anything you say about groups, use only titles, participants' names and
participant counts. Keep ids, provider details and internal reasons out.

## 3. Ask or hand off

Call `murph.group_consult` with `action="ask"` or `action="handoff"` and the
chosen `membershipId`. For a handoff, send factual context that does not
identify the member. The host adds any attribution that is appropriate for the
group.

When the chosen group is unavailable, or the call returns unavailable, name the
group by its title, say it cannot be used right now and that nothing was sent
or queued, and offer to work from a pasted message or a screenshot. Offer the
same when the member has no usable groups.

## Changing what a group can see

**Adding or turning on sharing** cannot be done from a private conversation,
and a handoff only posts context. After `list_memberships`:

- If the group's entry has a `permissionsUrl`, give the member that exact link.
- Otherwise tell them the next step: send the same request in that group chat,
  where Murph can show them a consent prompt to approve. Sharing settings can
  also change consent.

Lead with that next step. Do not hand off, say sharing is now on, or suggest
that something is temporarily broken.

**Revoking a disclosure grant** uses
`murph.group_data action="revoke_disclosure_grant"` with the exact grant id
from the `list_memberships` result just before it.
`murph.group_consult action="ask_member"` uses the grant id from
`read_current`.

Grants are listed in pages of their own, separate from groups. If the grant you
need is not on the page you have and `nextDisclosureGrantCursor` is set, repeat
the same action with that exact cursor until you find the grant or the cursor
is null. Once either list has returned a null cursor it is finished for this
turn, even if a later call shows a cursor for it again. `disclosureGrantsTruncated`
only means there are more pages. It does not mean the grant was denied or
revoked. Never guess a grant id.

**Leaving a group** uses `murph.group_membership action="leave_membership"`
with the chosen `membershipId`, when the member asks to leave it.

## What being in a group shares

- Joining shares the member's preferred display name. It does not share their
  private conversation, vault, account, billing, health or email data.
- Health data is shared only for the exact scopes the member approved. Email
  sharing needs the `group-email.v0` scope. A consent prompt grants only the
  scopes it lists, and a link grants nothing until it is accepted.
- Neither route grants Apple Health access. Missing Steps data never shows that
  someone refused or forgot an Apple Health permission.
- The health scopes a member can approve cover sleep (timing, total and
  stages), activity, workouts and heart-rate zones, steps, maximum and resting
  heart rate and HRV, distance, calories, elevation, floors, strain and VO2,
  and the source and sync status of their device. A shared workout carries its
  local start, duration, type and source. It never carries a route, location
  or heart rate.

## Reading shared records

`murph.group_membership action="read_current"` returns membership and
permission setup. It never returns shared records. The only way to read what
members have shared is `murph.group_data action="read_shared"`, with one to
three exact `projectionScopes`.

- `status="ok"` is a complete read. `status="partial"` lists
  `omittedParticipantIds`. Those people were left out for size, so do not infer
  that they left, how they scored or what they allowed, and do not call the
  standings complete.
- `not_granted`, `pending`, `missing` and `available` mean different things.
  Report the one returned.
- Records tagged with a source are reported separately, with no winner picked
  between sources. An untagged older record tells you nothing about its source
  or completeness.
- Use a `participantId` only where a tool asks for one. Never show raw provider
  or account ids, and never imply a maximum heart rate baseline.
