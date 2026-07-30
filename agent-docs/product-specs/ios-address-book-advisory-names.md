# iOS address-book advisory names

Last verified: 2026-07-29

## Product boundary

The iOS companion may offer one optional Contacts step after Apple Health.
Sharing lets Murph use a familiar address-book display name for a
phone participant in a group owned by the sharing member, whether or not that
participant already uses Murph.
Skipping makes no permission request and performs no backend mutation.

This is not a contact importer, invite system, signup prefill, global social
graph, identity proof, or membership/consent source. A label may improve the
current group reply only. It must not select a route, create an account, send a
message, grant access, persist profile truth, or override a registered
participant's Murph identity. Cross-owner signup prefill is deliberately
deferred: it would require a global lookup primitive and a conflict/consent
policy that this member-scoped design intentionally avoids.

## Projection

- iOS reads Contacts only after an explicit Share action and supports both
  limited and full system access.
- It inspects at most 5,000 person contacts, 20,000 phone values, and eight
  phone values per contact, then deterministically emits at most 1,000 rows.
- Each row contains a canonical E.164 phone number and either one safe
  first-name token plus an optional last initial, or two to four distinct safe
  labels joined by ` / ` when separate Contacts cards disagree. The separator
  communicates alternatives rather than inventing one full name or selecting
  a winner. iOS case-folds and sorts eligible labels, then keeps a possibly
  non-exhaustive prefix of four and omits later labels. It resolves
  structurally valid national formats with the Contacts framework's default
  country code and a pinned numbering-plan parser; invalid or ambiguous
  numbers, extensions, sentence-shaped labels, oversized combined labels,
  role/relationship labels, URLs, email-like labels, and non-person contacts
  are omitted.
- An empty projection cannot enable sharing. The server accepts an empty
  contact list only with the exact mutation id of an already-committed
  replacement so iOS can confirm a lost response without persisting contacts.
- Contact values are request-local on iOS. `UserDefaults` keeps only the last
  server revision, last permission scope, and idempotent replay metadata for
  at most one interrupted replacement and one pending deletion. It never
  stores projected contacts.

## Hosted storage and lookup

`apps/web` authenticates the companion with its ordinary Privy identity
bearer, requires active member access and current launch consent for
replacement, and accepts a closed schema with a 192 KiB body and 1,000-row cap.

For every readable token-key version, Web asks a dedicated non-exportable GCP
KMS HMAC-SHA256 key to derive a member-specific seed, then locally HMACs each
canonical phone number with that seed. Postgres stores only the member id,
token version, 43-character token, and an encrypted advisory name. It never
stores the uploaded phone number. The KMS MAC key must not be reused for web
root wrapping, app sessions, existing contact blind indexes, or any encryption
lane.

Rotation keeps the current and at most one prior readable version. The
token-version index is the retirement proof: do not advance the keyring again
until replacement, explicit stop, or account deletion has reduced the prior
version's contact-row count to zero. Because phone plaintext is never retained,
old rows cannot be re-tokenized in place.

With no timed expiry, a dormant projection can pin that prior version
indefinitely. This is an accepted tradeoff: Murph does not silently withdraw a
member's opt-in merely to complete routine key rotation. Routine rotation must
wait for the indexed prior-version count to reach zero through replacement,
Stop/Delete, foreground permission-loss reconciliation, or account deletion.

Emergency retirement is an ordered write-drain and reset:

1. Deploy both address-book gates Off, verify the Off deployment owns all Web
   traffic, and keep the affected KMS version enabled during the drain.
2. Retire every prior Web deployment, confirm the platform reports no active
   pre-change invocation, and wait at least the address-book route's explicit
   60-second maximum duration after the last old deployment stopped receiving
   traffic. If that drain cannot be proven, retirement is not complete.
3. Disable the affected KMS version. For each projection containing that token
   version, use one maintenance transaction with the normal delete-shaped
   lifecycle: lock the hosted-member owner, delete the complete contact list,
   set the projection Off, advance its revision, and retain the CAS/replay
   fence. Never physically erase only the projection row.
4. Verify the indexed affected-version contact count is zero and no enabled
   projection depends on an unreadable version.
5. Configure and fully deploy the new keyring, then reopen replacement writes.
   Affected members must explicitly share again under the new current key.
   Reopen advisory reads last.

The deterministic lifecycle test pauses an old-key replacement before its
transaction, drains it before the Off transition, proves a stale retry cannot
recreate sharing after the revision advances, and then proves an explicit fresh
share succeeds under the new key. Murph must never leave an enabled projection
whose token key is no longer readable.

This materially limits a Postgres dump or Postgres-plus-ordinary-content-key
compromise: neither contains the MAC authority required to test candidate
phone numbers. It is not zero knowledge. A live Web principal with MAC
permission, or an attacker controlling that principal, can enumerate
candidate numbers; live group processing also necessarily pairs a current
provider handle with a decrypted label. KMS IAM, provider/session retention,
and application compromise remain security boundaries and must not be
described otherwise.

There are three route-authorized consumers. The primary consumer is the existing
`read_chat_participants` operation:

1. Read and reconcile the truthful live Linq iMessage or SMS group roster.
2. Select at most 16 canonical phone handles while retaining each handle's
   durable activation result independently.
3. Resolve only the human group owner's enabled projection.
4. Carry each remaining single label or explicit multi-label alternative as
   internal `ownerAdvisoryName` and expose it to the model as participant
   `displayName`.
5. Treat KMS, consent, storage, timeout, or decryption failure as an empty
   optional overlay; never degrade the truthful roster.

Before KMS or token lookup, the advisory read must confirm that the owner still
exists, is unsuspended, holds current launch consent, and has an enabled
projection. It does not rerun the active member access check that gates
replacement: the route-authorized live group read is the access boundary for an
already-enabled projection, regardless of the owner's current personal or
sponsored billing access.

Across all three model-facing consumers, Murph is explicitly told to trust a
label as the participant's familiar conversational name, use it naturally when
helpful, and avoid unsolicited uncertainty or provenance disclaimers. If
someone asks how Murph knows one of these address-book names, Murph truthfully
identifies the group owner's shared address book as the source. That
presentation trust grants no identity, matching, membership, consent, routing,
instruction, or persistence authority. A ` / ` value remains explicit
alternatives rather than permission to choose one.

The second consumer is the automatic authenticated Linq transcript speaker-
label read. After durable ingress, the runtime batches the current turn's
unique sender handles through `read_participant_display_names`. Web first
requires an exact unique current joined, unsuspended membership and reads only
that membership's authorized `profile-name.v0` snapshot. A profile name wins.
Only a canonical phone with no member match, or one unsuspended match without a
profile name, may reach the existing set-based owner advisory-name reader;
ambiguous or suspended matches stay unnamed. Web returns no member or
participant id. The runner may reuse only the presentation result through its
operation memo and bounded snapshot-excluded file cache; the cache never
becomes profile, contact, membership, or effect authority. Full cache,
deadline, and rollout semantics live in
`agent-docs/references/hosted-runtime-protocol.md`.
The model-facing prompt renders the owner-contact result as
`Address-book name (display only):`; its internal source remains
`unverified-owner-contact` so presentation trust cannot erase provenance.

The third consumer is an exact provider-authenticated Linq
`participant.added` or `participant.removed` event for an existing active routed
group. Web normalizes the event's phone handle, first proves that the matching
hosted identity does not have active Murph activation evidence, and then may
consult the human group owner's projection. A successful label is included
with the canonical handle and change action as an `address-book name` in the
route's bounded encrypted transient group-event buffer. The participant
transaction takes the chat lock
before ledger insertion and staging, and the locked route rejects the Linq
account's own lookup key when `is_me` is absent. The next ordinary admitted
group message consumes that buffer and presents it to the model as weak
context, never as a message authored by the participant. Only the parenthetical
name in a complete server-generated participant-change entry is a trusted
address-book name. Text after a reaction entry's `reaction on:` marker remains
untrusted even when it imitates that form. Provider-event ledger rows retain no
handle or label. Lookup or crypto failure leaves additions with their existing
anonymous fallback hint and leaves removals without detailed context; neither
event wakes Murph or sends anything.
For a registered participant, the label remains only the owner's private
presentation hint: it does not replace or modify that participant's Murph
identity, and `hasOwnMurph` remains a separate durable-activation fact.

SMS admission is limited to `read_chat_participants`. Its model-facing result is
a roster read, but its Web owner also runs the existing best-effort Linq
participant reconciliation. That reconciliation renews or creates bounded
participant-derived access rows for resolved active participants and marks
absent projected participants removed. The rows are seven-day runtime-access
leases for the synthetic group container. This is the same container-liveness
projection used by iMessage groups and by Linq group provisioning and inbound
renewal; it grants no identity, consent, invite, delivery, or sharing authority.

The group skill may call this operation automatically on Murph's first ordinary
reply in a room. If it then requests contact-card sharing, the runtime withholds
the SMS thread context. Web returns `linq_thread_unavailable` before any
contact-card provider call, and the assistant continues the same reply without
claiming that a card was shared. Display-name and avatar changes, join offers,
disclosure requests, contact-card sharing, and every other chat effect remain
iMessage-only.

The advisory-name lookup itself does not write a canonical profile, participant
authority, or separate advisory-name state. The roster operation's existing
participant reconciliation is independent of the optional label overlay. The
participant-change consumer may write the label only inside the existing
encrypted, bounded, one-shot route buffer; it creates no mailbox item or wake.
Once the model includes a label in generated content, that content can exist in
the App Server provider thread, Murph session/workspace artifacts, the delivered
provider message, recipient devices, and backups under those surfaces' normal
retention rules. Stop, permission-loss cleanup, replacement, and account
deletion take the same owner lock as event-label staging and clear unconsumed
encrypted group-event buffers for that owner's routes. They cannot recall a
transient buffer already consumed or content already emitted to those surfaces.

## Lifecycle

Replacement and deletion are full-list compare-and-swap mutations over one
monotonic member revision. A canonical UUIDv4 mutation id gives exact replay;
reusing it for a different operation fails. Permission loss triggers deletion
only when the locally known server revision still matches. Explicit Stop and
Delete remains available on a newer revision because it only reduces sharing.

An enabled projection remains active until explicit Stop and Delete, account
deletion, or Contacts permission-loss reconciliation after the companion next
launches or foregrounds removes it. Revoking Contacts access while the app
remains closed does not contact the server. Account deletion explicitly deletes
both tables before the hosted member. Names already placed in provider messages
cannot be recalled and remain subject to provider, recipient, device, and backup
retention.

## Rollout

The conversational-name update does not change the Web-to-runner wire contract.
Deploy the runner prompt and model projection first, then deploy Web's
participant-event wording. Either order is schema-compatible, but runner-first
avoids a window where Web says `address-book name` while the old model contract
still asks Murph to distrust it. Verify both a labeled roster read and a labeled
participant event after both planes are live.

For the multi-label extension, deploy Web acceptance before distributing an iOS
build that may emit ` / `. Old iOS builds continue sending the existing
single-label subset, and the updated Web parser accepts both forms. Rolling Web
back after that iOS build has written a multi-label value can reject a replacement
and make the stored advisory overlay unreadable. Before such a rollback, stop
distribution of the new producer and turn both existing address-book gates Off.
Keep them Off until a compatible Web parser is restored; do not add a migration
or compatibility service for this emergency window.

1. Apply the additive Postgres migration.
2. Deploy the updated Cloudflare runner consumer while the current Web producer
   still emits the old payload; verify its bundle fingerprint and an unlabeled
   roster smoke.
3. Deploy Web with both gates off.
4. Configure the dedicated KMS MAC keyring and exact
   `roles/cloudkms.signerVerifier` key-level grant.
5. Deploy iOS and enable `HOSTED_ADDRESS_BOOK_REPLACEMENT_ENABLED=1`.
6. Verify replacement, deletion, permission-loss cleanup, persistence across
   time, and account deletion.
7. Complete privacy and retention review for App Server provider threads,
   session/workspace artifacts, provider delivery, recipients, and backups.
8. Enable `HOSTED_ADDRESS_BOOK_ADVISORY_NAMES_ENABLED=1` and exercise one
   labeled `read_chat_participants` result end to end.

Rolling back SMS roster admission stops new SMS-triggered roster refreshes but
does not erase participant-access rows already reconciled by that operation.
Those rows remain subject to the existing removal and seven-day lease rules;
group provisioning and authenticated participant inbound can still maintain
them through their canonical Linq paths.

The strict Web-to-runner response contract has this compatibility matrix:

| Producer/consumer state | Compatible |
| --- | --- |
| Old Web payload to updated runner | Yes |
| Updated Web with advisory reads off to old runner | Yes |
| Updated Web labeled payload to old runner | No |
| Updated Web labeled payload to updated runner | Yes |

This needs no compatibility shim because the advisory-read gate prevents the
only incompatible payload until the new consumer is live. Rollback disables
advisory reads before rolling back the runner, then disables replacement if
needed. DELETE remains available so disabling a producer cannot trap stored
data.
