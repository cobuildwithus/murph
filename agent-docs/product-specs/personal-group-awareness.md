# Personal Murph Group Awareness

Status: Implemented

Last verified: 2026-08-28

## User outcome

A member can ask their personal Murph which hosted groups they belong to and why a group can or cannot use a specific fact such as their preferred name, verified email, or HRV.

When an active member first establishes a routed Linq or Telegram group by
adding Murph and talking in that chat, the route transaction creates the
ordinary unnamed group and owner membership immediately. The owner can
therefore discover that group from private Murph without first creating a join
link. Other observed chat participants do not become members implicitly.

Murph answers from current web-owned membership and sharing authority. For each group it may report:

- the group display name, kind, member count, and the member's role
- the permission scopes the group currently requests
- the scopes this member currently grants to the group
- the existing first-party group join URL as a permission-management link only when the member owns the group and already authorized that link

The same link supports both initial join and later sharing changes. It is reusable invite authority, so personal Murph does not reveal it to ordinary members. A separate authenticated existing-member permission page remains future work.

## Product behavior

- `profile-name.v0` means the group is allowed to receive the member's memory-backed preferred display name.
- `group-email.v0` means the group is allowed to resolve the member's verified email for the group's authorized email flow.
- Health scopes such as `hrv-days.v0` are separate explicit grants. Group membership never implies them.
- A missing grant is sufficient to explain why the group lacks permission.
- An active grant is permission evidence only. It does not prove that the member currently has source data, that the source is fresh, or that the projection has already materialized in the group runtime. Murph should state that distinction when debugging a missing value.
- If the member is not the group owner or the group has no existing join code, personal Murph reports the membership and grants without inventing or exposing a link. Link creation and disclosure remain owner-authorized actions from the route-bound group runtime.
- One unnamed membership may be selected when it is the member's only group. Multiple unnamed memberships remain ambiguous and fail closed instead of guessing a destination.
- Each full membership-summary page is bounded to 25 rows because it includes
  permission scopes, counts, and first-party URLs. `nextCursor` continues in
  stable `(createdAt, id)` order, so later memberships remain discoverable and
  manageable instead of becoming unavailable at row 26. A malformed cursor
  fails explicitly; it is never treated as an empty final page.
- Active disclosure grants use an independent 25-row page and
  `nextDisclosureGrantCursor`. Following one cursor never advances or hides the
  other collection.

## Authority and privacy

`apps/web` remains the only owner of hosted group membership and grant state:

- `HostedGroupMember` proves the callback-authenticated member belongs to a group
  and supplies the opaque selector for leaving that exact membership.
- `HostedGroup.joinPolicyJson` supplies requested permission scopes.
- active `HostedVaultShare` rows from that member to the group's runtime supply granted scopes.

The canonical thread-route owner composes initial group materialization through
the existing group-store primitive in the same transaction. That structural
write creates only the route owner membership. It does not grant a vault share,
mint a join code, request health or email sharing, import a provider title, or
enroll roster participants. Existing owner-authorized setup and explicit join
flows retain their sharing behavior. Because this is the ordinary canonical
membership rather than a discovery-only projection, the owner also qualifies
for existing current-participant group actions, including outbound phone calls
and physical notes. Those effects retain their independent exact-message,
activation, usage, explicit-request, and pre-provider authority checks; an
observed roster participant without a membership remains ineligible.

The personal list derives its member id from the signed hosted callback. The
model cannot choose another member. Results may include the member's own opaque
membership ids so private Murph can select one for `leave_membership`; Web
rechecks that the selector belongs to the callback member before mutation. The
result omits the group roster, other member ids, handles, emails, names, and
sharing state.

The hosted runner does not create a canonical membership copy in the personal vault or assistant runtime. Each call reads current web-owned truth. The response may remain in normal provider-native thread continuity and its referenced encrypted workspace snapshot; do not clear the provider session merely because the read is private.

## Interface choice

Personal visibility uses `murph.group_membership action="list_memberships"`. The family descriptor still dispatches through the one hosted group control boundary and adds no API route or state owner.

When the requested membership or disclosure grant is not on the current page,
Private Murph repeats `list_memberships` with the exact opaque cursor returned
by Web until it finds the selector or exhausts the collection. The model never
constructs, edits, or accepts either cursor from the member.

Inventory-v2 callers also receive one `participantRoster` result per membership.
An available result contains the real human chat participant count, including
the requester, and safe labels for the other people: requester-authorized
Contacts names, masked phone hints, or a generic email marker. Unsupported
providers, missing routes, incomplete rosters, and provider failures are
entry-local unavailable results. They do not hide the membership or poison
another entry. Ask and handoff may use only the exact opaque `membershipId`
returned by this read; safe titles, counts, and labels help the model clarify
but never authorize an effect.

Permission changes stay on the existing authenticated join page for members who already possess the owner-authorized link. Private Murph's only membership mutation is self-leave, selected from its current Web-owned list and bound to the signed callback member. Reacting in a personal direct-message thread to change a group permission remains deliberately out of scope. Existing server-owned reactions inside a route-bound group chat remain unchanged.

The authenticated join page renders the viewer's current opaque membership id,
or explicit absence for a nonmember, into every accept request. After locking
the group and callback member, Web compares that rendered state with the current
membership row before creating membership or changing grants. Missing or stale
rendered state returns a reload conflict. This keeps an older `Save changes`
request from recreating membership or sharing after a later leave commits, while
a reloaded nonmember can still explicitly rejoin and receive a fresh row id.
The route-bound additive group-reaction flow does not use this page precondition.

### Leaving a membership

A non-owner may leave one of their hosted groups by asking their private Murph
or by using that group's join page while authenticated. Private Murph first
reads the member's own memberships, then calls `leave_membership` with the
opaque membership id returned for the selected group. The signed callback is
the actor authority; the id is only a selector, and a foreign or stale id cannot
affect another member. The existing join page instead binds the actor to the app
session and the group to the link already being viewed.

Web commits either path as one transaction: it revokes every active share from
that member to the group runtime, clears each row-owned encrypted snapshot, and
deletes the membership row. No runtime cleanup envelope is required. The canonical owner cannot
leave. Repeating a completed leave is safe, and a later explicit join creates a
new membership. The leave mutation itself is not gated by launch consent,
suspension status, or billing/runtime access. Asking private Murph still depends
on that existing runtime being reachable, and the join-page fallback requires
an existing authenticated app session; neither surface introduces a new
reauthentication or inactive-message path.

The confirmation must describe the boundary precisely. Murph membership and
future sharing end, and Murph-owned projected copies are queued for cleanup.
This does not remove the person from the iMessage chat or erase historical
messages, provider copies, backups, or copies already shared outside Murph. A
provider output already accepted before departure can still arrive once.
Because membership remains row-presence truth, an old affirmative join reaction
that the existing system later accepts can create a fresh membership after a
leave. Fencing that provider replay would require the lifecycle/epoch machinery
deliberately excluded from this minimal behavior.

## Deployment compatibility

Every successful `list_memberships` summary now requires a nonblank
`membershipId`. Web derives it directly from the required
`HostedGroupMember.id` primary key, and the hosted runner rejects an omitted or
null value instead of treating it as a temporarily unavailable leave selector.

Web #676 or newer is therefore the rollback floor while the strict runner is
active. Deploy the strict Cloudflare runner only after confirming Web remains
at or above that floor. A tolerant runner rollback is safe; if both planes must
roll back below the floor, roll Cloudflare back first and then Web. The hard cut
does not require immediate container rollout because both old and new runners
accept the current Web response, but post-deploy proof must exercise one private
`list_memberships` read and check for group-tool response parse failures.

The pagination fields are a second parser-first compatibility boundary. Deploy
the hosted runner/assistant consumer that accepts membership and disclosure
cursors before Web begins returning `nextCursor`,
`nextDisclosureGrantCursor`, or the disclosure truncation marker. Web continues
to accept initial requests without either cursor. After Web emits these fields,
rolling the runner behind that parser floor would reject otherwise successful
reads.

Participant roster and action availability use versioned query capability
markers rather than unconditional response expansion. Existing
Cloudflare/runner code sends `membershipInventoryProtocol=v2` and receives the
roster-only shape. New code sends `membershipInventoryProtocol=v3` and receives
both the roster and per-membership action availability. New Web accepts both
versions; callers without either exact marker retain their strict legacy
response shape. Deploy Web first, then recycle Cloudflare/runner onto v3. Roll
back Cloudflare/runner to v2 before rolling back Web. During either skew window,
membership listing and leaving remain compatible, and only v3 callers depend on
the new availability field.

## Direct proof

At minimum, verify these cases:

1. A personal member in several groups receives only their own memberships and grants.
2. A requested but ungranted HRV scope is distinguishable from an active HRV grant.
3. Name and email grants are reported without returning their underlying values.
4. An existing join code becomes a first-party permission URL for the group owner only; ordinary members and missing codes remain `null`.
5. Unsupported selector scopes are filtered for older callers.
6. An inactive caller receives structured unavailability.
7. A non-owner's private-tool or authenticated join-page departure atomically
   removes membership, revokes all active grants, and clears their encrypted
   snapshots without runtime cleanup work; an
   owner attempt makes no change and a repeated departure remains idempotent.
8. A member with more than 25 memberships can discover and act on a later page.
9. A member with more than 25 active disclosure grants can discover and revoke
   a later-page grant without expanding one decrypted response beyond 25 rows.
10. If leave commits before an older existing-member sharing save, the save
   conflicts without recreating membership or grants. If the save commits first,
   the later leave still ends left; a reloaded nonmember can explicitly rejoin.
