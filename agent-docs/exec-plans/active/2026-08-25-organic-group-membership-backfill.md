# Materialize product groups for every routed group runtime

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Make every newly routed hosted group immediately discoverable from its
  owner's private Murph by materializing the existing `HostedGroup` and owner
  `HostedGroupMember` state in the canonical route-creation transaction.
- Backfill existing routed group runtimes that are missing that product state
  with one bounded, idempotent operator command that reuses the same owner.

## Product UX Plan

- Effort: Product change. This intentionally moves ordinary group
  materialization from the first join-link action to canonical route creation.
- Outcome: adding Murph to an existing group is enough for that group's owner
  to find it from private Murph and request an existing private-to-group
  handoff; no separate Murph-created group or join-link step is required.
- Reaches: owners of existing organic Linq and Telegram group chats, owners of
  future organic groups, and joined members whose explicit membership remains
  unchanged.
- Proof: compose canonical route creation with the persisted group and owner
  membership reads, and prove the backfill is bounded, resumable, and
  idempotent.

### Entry and promise

- The first accepted inbound message that creates an organic group route also
  establishes the already-selected route owner as the canonical group owner.
- The owner's private Murph can then list or select that group through the
  existing membership-owned tools. No join link is created or exposed.

### Affected people

- Route owner with one group: the unnamed membership is selectable through the
  existing single-membership path and carries only the normal automatic
  profile-name share.
- Route owner with several groups: existing exact-name selection remains; if
  unnamed groups make selection ambiguous, Murph fails closed and asks the
  owner to name the target rather than guessing.
- Other provider-chat participants: roster observation alone creates no
  `HostedGroupMember`, grant, private-group visibility, Core eligibility, or
  handoff authority. The existing explicit join flow remains required.
- Existing owner: the bounded backfill creates the same group and owner state
  without a new message, join code, or provider effect. Inactive-runtime and
  later handoff failures retain their existing truthful unavailable behavior.

### Product effects and exclusions

- The normal owner membership also grants the existing automatic
  `profile-name.v0` projection and qualifies through current membership-based
  product rules such as Core eligibility. That is accepted ordinary membership
  behavior, not a new special group class.
- Funding remains available through the existing signed funding-only locator
  whenever no owner-created join code exists. The locator itself still writes
  no state or grants and remains invalid on join surfaces.
- No health, email, roster, or other sharing grant is inferred. No provider
  group title is imported as a Murph display name.

## Scope

- In scope: future routed-group materialization, one temporary aggregate-only
  backfill command, focused composed persistence proof, durable architecture
  and verification documentation, deployment, production convergence, and
  removal of temporary backfill machinery after convergence.
- Out of scope: message wording, handoff model behavior, roster-based
  membership, join-link creation, new group kinds, new tables, new queues,
  schedulers, or periodic repair.

## Constraints

- `HostedGroup` and `HostedGroupMember` remain the only product group and
  membership owners.
- The existing thread-container route remains the only external-thread routing
  owner.
- Organic groups begin unnamed and without a join code; ambiguous unnamed
  multi-group selection continues to fail closed.
- Only the canonical container owner becomes an owner member automatically.
  Observed provider participants do not become product members without the
  existing explicit join flow.
- Backfill work is serial, batch-bounded, database-only, idempotent, and emits
  aggregate counts without identifiers or conversation data.
- ReviewGPT authors the initial implementation patch. The parent inspects and
  applies every hunk, owns all remediation, and runs the normal exact-head
  review gates.

## Tasks

1. Have ReviewGPT return the smallest patch that reuses the existing group
   materialization primitive for future routes and a bounded one-time backfill.
2. Inspect and apply the patch, rejecting duplicated state or operational
   machinery and completing any missing composed proof.
3. Run focused Web tests, Prisma generation when needed, Web typecheck, docs
   checks, and privacy/diff inspection.
4. Commit and push the candidate, open a draft PR, and start the preliminary
   specialist and final ReviewGPT gates concurrently with CI on the exact head.
5. Resolve accepted findings, merge and deploy, run dry-run/apply/check until
   production reports zero missing groups, then remove the temporary backfill
   command and its operator-only documentation in a cleanup PR.

## Verification

- Focused route-creation persistence test proving one ordinary unnamed group,
  one owner membership, no join code, and no roster-member auto-enrollment.
- Focused backfill tests proving batch bounds, aggregate-only summaries,
  idempotent replay, and convergence.
- Web typecheck, `git diff --check`, docs drift/gardening, exact-head CI, and
  applicable ReviewGPT gates.
- Production dry-run, bounded apply batches, final zero-candidate check, and a
  narrow aggregate database verification.

## Deployment concerns

- Deploy the future-write path before applying the backfill so new gaps cannot
  race the convergence pass.
- The change is Web/database-only and introduces no schema change or
  Cloudflare compatibility dependency.
- Backfill begins in dry-run mode, applies one small batch per invocation, and
  can stop safely between batches.
