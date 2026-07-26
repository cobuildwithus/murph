# iOS address-book advisory names

Last verified: 2026-07-26

## Product boundary

The iOS companion may offer one optional Contacts step after Apple Health.
Sharing lets Murph use a familiar, unverified first-name label for an
unregistered phone participant in a group owned by the sharing member.
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
  phone values per contact, then deterministically emits at most 512 rows.
- Each row contains an explicit international phone number and one safe
  first-name token plus an optional last initial. National-only numbers,
  sentence-shaped labels, ambiguous duplicate
  names, role/relationship labels, URLs, email-like labels, and non-person
  contacts are omitted.
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
replacement, and accepts a closed schema with a 96 KiB body and 512-row cap.

For every readable token-key version, Web asks a dedicated non-exportable GCP
KMS HMAC-SHA256 key to derive a member-specific seed, then locally HMACs each
canonical phone number with that seed. Postgres stores only the member id,
token version, 43-character token, and an encrypted advisory name. It never
stores the uploaded phone number. The KMS MAC key must not be reused for web
root wrapping, app sessions, existing contact blind indexes, or any encryption
lane.

Rotation keeps the current and at most one prior readable version. The
token-version index is the retirement proof: do not advance the keyring again
until replacement and expiry have reduced the prior version's contact-row
count to zero. Because phone plaintext is never retained, old rows cannot be
re-tokenized in place.

This materially limits a Postgres dump or Postgres-plus-ordinary-content-key
compromise: neither contains the MAC authority required to test candidate
phone numbers. It is not zero knowledge. A live Web principal with MAC
permission, or an attacker controlling that principal, can enumerate
candidate numbers; live group processing also necessarily pairs a current
provider handle with a decrypted label. KMS IAM, provider/session retention,
and application compromise remain security boundaries and must not be
described otherwise.

The only consumer is the existing route-authorized
`read_chat_participants` operation:

1. Read and reconcile the truthful live Linq/iMessage roster.
2. Select at most 16 canonical phone handles whose durable activation check
   says they do not yet use Murph.
3. Resolve only the human group owner's active, unexpired projection.
4. Omit ambiguous labels and return each remaining label as
   `unverifiedOwnerContactLabel`.
5. Treat KMS, consent, storage, timeout, or decryption failure as an empty
   optional overlay; never degrade the truthful roster.

The model sees the label only for the current tool result and is explicitly
told that it is untrusted presentation text with no identity, membership,
consent, routing, instruction, or persistence authority.

## Lifecycle

Replacement and deletion are full-list compare-and-swap mutations over one
monotonic member revision. A canonical UUIDv4 mutation id gives exact replay;
reusing it for a different operation fails. Permission loss triggers deletion
only when the locally known server revision still matches. Explicit Stop and
Delete remains available on a newer revision because it only reduces sharing.

An enabled projection expires 120 days after its last replacement. The
existing hosted retention job deletes child rows and disables expired
projections in bounded batches. Account deletion explicitly deletes both
tables before the hosted member. Names already placed in provider messages
cannot be recalled and remain subject to provider, recipient, device, and
backup retention.

## Rollout

1. Apply the additive Postgres migration.
2. Deploy the Web consumer with both gates off.
3. Configure the dedicated KMS MAC keyring and exact
   `roles/cloudkms.macSignerVerifier` key-level grant.
4. Deploy iOS and enable `HOSTED_ADDRESS_BOOK_REPLACEMENT_ENABLED=1`.
5. Verify replacement, deletion, permission-loss cleanup, retention, and
   account deletion.
6. Enable `HOSTED_ADDRESS_BOOK_ADVISORY_NAMES_ENABLED=1`.

Rollback disables advisory reads first and replacement second. DELETE remains
available so disabling a producer cannot trap stored data.
