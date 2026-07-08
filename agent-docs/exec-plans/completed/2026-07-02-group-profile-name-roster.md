# Group Profile Name Projection And Roster

## Goal

Group-chat Murph should know each participant by name and know whose shared
data is whose, without ever re-asking a question members answered during
onboarding. Close the identity join across the three namespaces in a group
container: chat sender handle, group membership, and vault-share grantor.

## Design

1. **Typed canonical home for the display name.** The preferred name today
   lives only in freeform Identity memory text, which a deterministic
   projector must not parse. Add a standalone typed vault document
   (`bank/profile.md`, own docType/schema in `@murphai/contracts`, mirrored on
   the memory-document pattern) holding `displayName`. New `vault-cli profile`
   command (set-name/show); `@murphai/query` gains a deterministic reader.
   A standalone document avoids memory-frontmatter deploy skew (old strict
   parsers must never see new fields). Onboarding and 1:1 guidance save the
   name here going forward; existing members backfill opportunistically on
   their next assistant turn (assistant already knows the name from memory).
2. **`profile-name.v0` vault-share projection kind.** Single bounded record
   `{ displayName }`, recordKey `profile-name`; deterministic projector reads
   the typed profile document; delivered through the existing deliver path and
   the existing kind-generic destination import. No parser widening.
3. **Auto-grant on membership.** Joining a group always grants
   `profile-name.v0` (grantor = joiner, destination = container); the owner's
   grant is created with the group. Introducing yourself by name is what
   joining means; the join page states it plainly. Health kinds stay
   individually selectable; profile-name is not a checkbox and not requestable
   via `create_join_link` (selectable-kind list excludes it).
4. **Roster on `murph.group read_current`.** Group summary gains
   `members: [{ memberId, handle, role, grantedVaultShareProjectionKinds }]`
   derived server-side (handle from the member's verified phone identity,
   grants from `HostedVaultShare`); no new persisted state. The runtime joins
   `Sender:` handle → roster → delivered profile-name → grantor data.
5. **Skill guidance.** group-chat skill: read the roster, address people by
   name, attribute shared data through it, use the handle gracefully until a
   name arrives.

## Constraints

- Utmost priority: clean, simple, composable, minimal complexity. Every piece
  mirrors an existing pattern (frontmatter document, projection kind registry,
  share-grant store, group tool). No new managers, queues, or persisted state
  beyond the canonical profile document.
- Deterministic projection only; never parse freeform memory text.
- Never re-ask users for their name.
- Vault-share remains the only data-sharing grant; membership-implied name
  sharing is still a `HostedVaultShare` row the server revoke machinery fully
  supports. Its lifetime is deliberately coterminous with membership: the join
  page states the share plainly, and ending membership (today: the account
  privacy-deletion path; no leave-group surface exists yet for any grant) is
  the revoke path. The join-page revisit deselect flow governs only the
  individually selectable health kinds, by design.
- Deep-review perf note (accepted as-is): the `read_current` roster does one
  identity read + private-state decrypt per member, bounded by real group-chat
  size; at group creation the roster is the owner alone, and `read_current`
  runs outside any transaction.
- `profile-name.v0` is a current-state kind
  (`isHostedVaultShareCurrentStateProjectionKind`): fixed recordKey, no
  delivery recency bound, and a content-only delivery revision (occurredAt is
  excluded from the dedupe hash so timestamp drift on an unchanged name cannot
  mint unbounded mailbox dedupe keys).

## Verification Plan

- contracts/query/cli unit tests for the profile document.
- hosted-execution parser tests for `profile-name.v0`.
- assistant-runtime projector + offer tests.
- apps/web tests: join-accept auto-grant, owner grant at create, roster
  read_current shape, selectable-kind exclusion.
- `pnpm test:diff`; PR + ReviewGPT loop (Mountain lane) to zero findings.

## State

In progress.
Status: completed
Updated: 2026-07-02
Completed: 2026-07-02
