# Personal Murph Group Awareness

Status: Implemented

Last verified: 2026-07-15

## User outcome

A member can ask their personal Murph which hosted groups they belong to and why a group can or cannot use a specific fact such as their preferred name, verified email, or HRV.

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
- Results are bounded. If the bound is reached, Murph says the list was truncated rather than implying it is complete.

## Authority and privacy

`apps/web` remains the only owner of hosted group membership and grant state:

- `HostedGroupMember` proves the callback-authenticated member belongs to a group
  and supplies the opaque selector for leaving that exact membership.
- `HostedGroup.joinPolicyJson` supplies requested permission scopes.
- active `HostedVaultShare` rows from that member to the group's runtime supply granted scopes.

The personal list derives its member id from the signed hosted callback. The
model cannot choose another member. Results may include the member's own opaque
membership ids so private Murph can select one for `leave_membership`; Web
rechecks that the selector belongs to the callback member before mutation. The
result omits the group roster, other member ids, handles, emails, names, and
sharing state.

The hosted runner does not create a canonical membership copy in the personal vault or assistant runtime. Each call reads current web-owned truth. The response may remain in normal provider-native thread continuity and its referenced encrypted workspace snapshot; do not clear the provider session merely because the read is private.

## Interface choice

Personal visibility extends the existing `murph.group` dynamic tool with `action="list_memberships"`. This keeps one hosted group control boundary and avoids a second API route or state owner.

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
that member to the group runtime, appends the existing durable projection
cleanup envelopes, and deletes the membership row. The canonical owner cannot
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

## Direct proof

At minimum, verify these cases:

1. A personal member in several groups receives only their own memberships and grants.
2. A requested but ungranted HRV scope is distinguishable from an active HRV grant.
3. Name and email grants are reported without returning their underlying values.
4. An existing join code becomes a first-party permission URL for the group owner only; ordinary members and missing codes remain `null`.
5. Unsupported selector scopes are filtered for older callers.
6. An inactive caller receives structured unavailability.
7. A non-owner's private-tool or authenticated join-page departure atomically
   removes membership, revokes all active grants, and appends cleanup work; an
   owner attempt makes no change and a repeated departure remains idempotent.
8. If leave commits before an older existing-member sharing save, the save
   conflicts without recreating membership or grants. If the save commits first,
   the later leave still ends left; a reloaded nonmember can explicitly rejoin.
