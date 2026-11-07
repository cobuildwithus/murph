---
name: private-group-access
description: Use in a private conversation before acting on one of the member's Murph group chats from here, such as asking a joined group something, posting or handing context to it, choosing among their groups, changing or revoking what a group can see, leaving a group, or explaining what group membership shares.
---

# Group chats from the private conversation

## Sharing permission requests

If asked to add or enable a group's sharing permission here, first inspect
`list_memberships`. Give the selected group's exact `permissionsUrl` when
available. Otherwise, lead with the next step: ask the member to send that
request in the named group chat, where Murph can show a consent prompt for them
to approve. Sharing settings also support consent changes. Private chat has no
projection-grant mutation; a `group_consult` handoff only posts context and
cannot make this change. Do not hand off, claim a grant, imply a temporary
outage, or stop at an inability statement.

## Asking or handing off to a joined group

- Joined-group consultation works only for groups Murph has already joined; it
  cannot reach an unjoined device chat. State that distinction for capability
  questions, and search or load deferred `murph.group_consult` via
  `tool_search` or code-mode `ALL_TOOLS` before redirecting or denying.
- Before `murph.group_consult action="ask"` or `action="handoff"`, call
  `murph.group_membership action="list_memberships"`; do not claim this build
  cannot access or message a joined group before using that inventory.
- Exhaust the membership cursor chain before choosing or asking the final
  clarification: while `nextCursor` is nonnull, call `list_memberships` again
  with that exact cursor.
- Resolve the member's ordinary cue against every inventory entry's title and
  available participant roster before applying `availability`: availability
  controls whether the resolved destination can be used, never whether it is a
  semantic match. An omitted availability field is a legacy entry and remains
  usable. Never remove an unavailable match and thereby select another group.
  Never treat `truncated`, one unavailable entry, or one entry's unavailable
  roster as global unavailability.
- Select only an exact opaque `membershipId` returned in this conversation.
  Never expose, quote, edit, infer, or ask the member for it.

## Choosing among groups

- A participant cue is inclusive: every inventory entry containing that safe
  label stays a candidate even when its roster has more people. Do not treat
  people the member omitted as exclusions unless they say "only".
- When several entries remain, ask one concise natural clarification using only
  their safe titles, other safe participant labels, and
  `participantRoster.participantCount`, the real chat participant count. Never
  use `memberCount` for this; it counts only Murph members. When visible titles
  collide, give every candidate its own real participant count or other safe
  label instead of calling one "the other".
- You may note that a candidate is not available right now, but never mention
  unavailable internals. If participant details are unavailable for one entry,
  its safe title can still distinguish it, but never guess among unresolved
  entries or fan out.
- After the destination is resolved, use it only when available. If the
  selected entry is unavailable, or a selected ask or handoff returns
  unavailable, name the safe title, say explicitly that the chat cannot be used
  right now and nothing was queued, offer the paste-or-screenshot fallback, and
  never select an unrelated group or expose identifiers, provider details or
  the internal reason. With no usable memberships, offer the same fallback.
- For a handoff, send only identity-neutral factual context; the host supplies
  any group-safe attribution.

## Disclosure grants

Disclosure grants are paged independently from memberships. Track each cursor
chain separately. When one chain returns its null next cursor, it is exhausted
for this turn; advancing the other chain may re-list the exhausted chain's first
page, so ignore any renewed cursor or truncation for the exhausted chain and
never restart it. When the grant needed for `ask_member` or
`revoke_disclosure_grant` is not on the current `read_current` or
`list_memberships` page and `nextDisclosureGrantCursor` is nonnull, repeat that
same action with the exact cursor until found or exhausted. Never treat
`disclosureGrantsTruncated` as denial, revocation or unavailability, and never
guess a grant id.

## Membership and shared data

- `murph.group_membership action="read_current"` is membership and permission
  setup only, never shared records. `murph.group_data action="read_shared"` is
  the only hosted path for shared facts. Request one to three exact
  `projectionScopes` for an ordinary read. The host resolves live access after
  the call. `status="ok"` is complete. Model-size `status="partial"` lists
  current `omittedParticipantIds`; never infer their departure, score,
  diagnostics or permission, or call the standings complete. Use
  `participantId` only as the group-scoped selector an owning tool requires.
  Keep `not_granted`, `pending`, `missing` and `available` distinct.
- After `read_current`, use the group-chat skill's core permissions only for
  `status=none`; existing groups use workflow scopes.
- Group membership shares the member's preferred display name, not their
  private chat, vault, account, billing, health or email data. Health and email
  sharing require the exact server-owned projection scopes; email requires
  `group-email.v0`. Native consent grants only its disclosed scopes; a link
  grants nothing until accepted. Neither path grants Apple Health access, and
  missing Steps never proves someone denied or forgot Apple Health permission.
- Shared health: sleep timing, total and stages; activity, workouts and HR
  zones; steps; max and resting HR and HRV; distance, calories, elevation,
  floors, strain and VO2; `device-sync-status.v0` source label, status and
  sync. Return tagged records separately with no cross-source winner. Legacy
  records may be untagged: never infer source or completeness. New access uses
  v1; v0 only for existing requests or grants. `workouts.v0`: local start,
  duration, type and source in event or vault zone; no timestamp, route,
  location or HR. Never imply max-HR baselines or expose raw provider or
  account ids.
