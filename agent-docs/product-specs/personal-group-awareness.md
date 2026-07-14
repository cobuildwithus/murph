# Personal Murph Group Awareness

Status: Implemented

Last verified: 2026-07-10

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

- `HostedGroupMember` proves the callback-authenticated member belongs to a group.
- `HostedGroup.joinPolicyJson` supplies requested permission scopes.
- active `HostedVaultShare` rows from that member to the group's runtime supply granted scopes.

The personal tool is read-only and derives its member id from the signed hosted callback. The model cannot choose another member. The result omits the group roster, other member ids, handles, emails, names, and sharing state.

The hosted runner does not persist a copy in the personal vault or assistant runtime. Each call reads current web-owned truth.

## Interface choice

Personal visibility extends the existing `murph.group` dynamic tool with `action="list_memberships"`. This keeps one hosted group control boundary and avoids a second API route or state owner.

Permission changes stay on the existing authenticated join page for members who already possess the owner-authorized link. Reacting in a personal direct-message thread to change a group permission is deliberately out of scope: it would require a new message-bound authorization and irreversible-effect path. Existing server-owned reactions inside a route-bound group chat remain unchanged.

## Deployment compatibility

The response contract widens across the hosted runner and web control plane. Deploy the Cloudflare worker and runner bundle first, with immediate container rollout and convergence proof, then deploy web. Old web never emits `list_memberships`; updated web must not emit it to a warm runner whose strict parser does not recognize the action.

After web deploy, do not roll the runner below the `list_memberships` parser while web can receive calls from updated assistant tool schemas. Roll web back first if the runner must be rolled back.

## Direct proof

At minimum, verify these cases:

1. A personal member in several groups receives only their own memberships and grants.
2. A requested but ungranted HRV scope is distinguishable from an active HRV grant.
3. Name and email grants are reported without returning their underlying values.
4. An existing join code becomes a first-party permission URL for the group owner only; ordinary members and missing codes remain `null`.
5. Unsupported selector scopes are filtered for older callers.
6. An inactive caller receives structured unavailability.
