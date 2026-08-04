# Physical Notes

## Status

Specified and implemented behind an explicit runtime capability, Lob
configuration, and a live-send kill switch.

## Product

Murph can mail one expressive, US-only physical note from a direct conversation
or a hosted group. GPT Image generates the complete color artwork page, including
any handwriting, illustration, and a small `murph ai` mark. Murph may show the
artwork first when a draft or choice is useful, but an explicit send request with
a complete recipient address may continue through generation and mailing without
an extra preview round trip. The platform supplies Murph's fixed return address;
it is never collected from the person sending the note.

Each hosted member receives one complimentary note under the versioned
`physical-note-v1` offer. A hosted group receives its own complimentary note
because its synthetic thread-container runtime is already a hosted member and
the existing usage beneficiary. Later notes consume the configured Lob provider
cost from that beneficiary's ordinary Murph usage; there is no note-specific
wallet or credit type.

## Composition

The assistant composes two existing-style primitives:

1. `murph.generate_image` creates and saves one private portrait image. Mail
   flows pass the exact accepted `message_ref`; generic image generations remain
   composable but cannot authorize an automatic physical send.
2. The existing hosted image completion re-enters the same Codex conversation as
   a trusted system input. No note workflow, polling loop, scheduler, automation,
   or second continuation owner is added.
3. `murph.send_physical_note` materializes and hashes the exact saved image,
   publishes a short-lived private capability, and asks Web to submit it to Lob.

On the immediate completion turn the send tool infers the trusted image only
when its completion carries that exact accepted origin. When Murph showed the
artwork first, a later user-authored send turn provides the exact trusted vault
ref, SHA-256, and current approving `message_ref`; runtime code re-reads the
private bytes and independently reauthorizes the exact input in direct and group
conversations. The image-launch turn sends a short acknowledgement rather than
silently ending. If graceful runtime shutdown interrupts generation, the
existing completion channel durably stages one failed result so a restart can
tell the conversation instead of losing the continuation.

## Ownership and persistence

Web owns the sole durable `HostedPhysicalNote` row. It stores only operational
facts: beneficiary, request identity and fingerprint, provider id, status,
complimentary offer code, configured provider cost, pricing version, and
timestamps. It never stores the postal address, image URL, artwork, prompt, or
note text.

The exact authorized input derives the request key. The artwork and recipient
remain in the separate request fingerprint, so reusing one approval with changed
content is a collision rather than a second effect. Accepted replays resolve
from the durable row even after the temporary artwork capability expires; an
existing uncertain send remains pending rather than being rewritten. After that
replay check, Web constructs the provider runtime and a later request may repair
one stale complimentary claim against Lob. Confirmed acceptance finalizes the
stale row, confirmed absence releases its claim, and an indeterminate lookup
changes nothing. The current request then validates the artwork lifetime,
reasserts final group authority, observes caller cancellation, and follows its
ordinary member-locked admission, provider effect, replay, and response path.

`memberId + complimentaryOfferCode` atomically admits one complimentary note per
direct member or synthetic group member. A definite provider rejection releases
the promotional claim; an ambiguous outcome keeps the row pending and is never
blindly resent after Lob's idempotency window. Once admitted, the provider call
uses its own bounded timeout rather than caller cancellation, preventing a
durable reservation with no matching provider attempt.

For paid notes, `starting` rows from the current allowance period reserve their
already-frozen provider cost under the same member lock used by allowance
admission. Older ambiguous rows remain auditable but do not reduce a new
period's capacity. Concurrent sends therefore cannot each spend the same
remaining capacity, and no second balance owner is needed.

## Provider boundary

Web alone holds `LOB_API_KEY` and the configured return-address id. The assistant
and tool schema accept only the recipient address. Lob receives one color US
Letter request using First Class mail, `insert_blank_page`, and a provider
idempotency key equal to the physical-note id. The generated artwork is wrapped
only in deterministic letter-sized transport HTML with the required print-safe
margin; visual expression remains model-owned.

USPS Secure Destruction is an account-level Lob setting rather than a per-letter
API field. Operators enable it in the Lob account before live sending so eligible
undeliverable First Class notes are destroyed instead of returned to Murph's
mailbox. The runtime keeps every note on First Class mail, and a `live_` key is
rejected unless both `LOB_PHYSICAL_NOTES_LIVE_ENABLED=true` and
`LOB_USPS_SECURE_DESTRUCTION_CONFIRMED=true` are present. The confirmation flag
does not change the Lob account; it records that an operator already enabled the
account setting.

Test keys may render proofs without the two live-account confirmations. The
charged amount comes from `LOB_PHYSICAL_NOTE_COST_USD_MICROS` and its explicit
pricing version, not from a scraped public rate.

Cloudflare exposes the composable tool only when the non-secret platform
capability `HOSTED_PHYSICAL_NOTES_ENABLED=true` is set. This flag must be enabled
only after Web's Lob configuration is ready. Web still fails closed as
`unavailable` when provider configuration is absent or invalid, and durable
accepted replays resolve from their stored row without depending on current Lob
configuration.

## Authority and safety

One explicit user-authored send request authorizes one note. In a group, any
current activated participant may originate the request; the group runtime owns
the benefit and usage. The service uses the repository's canonical
participant-aware thread-container access derivation, so an inactive owner does
not block an otherwise authorized active participant. It does not add a
physical-note-specific entitlement path.

The tool remains bounded to one domestic recipient and rejects bulk,
international, threatening, harassing, fraudulent, impersonating, doxxing, or
illegal mail through product policy and the constrained tool shape.

`accepted` means Lob accepted the mailpiece for printing; it does not mean USPS
delivered it. An accepted physical mailpiece cannot be recalled by deleting the
Murph account. Local operational rows delete with the hosted member, while Lob
and postal-service retention remain governed by those providers.

## Deployment

Deploy the Prisma migration and Web route/service first, with live sending off.
Then deploy Cloudflare and the assistant runtime/tool surface with
`HOSTED_PHYSICAL_NOTES_ENABLED` still off. Configure Lob's fixed Murph return
address and enable USPS Secure Destruction in the Lob account. Verify at least
one Lob test-mode proof before enabling the Cloudflare capability. Set
`LOB_USPS_SECURE_DESTRUCTION_CONFIRMED=true` only after the account setting is
active, then enable live sending. The older runtime simply lacks the tool during
a Web-first compatibility window; a new runtime against an old Web deployment
would expose a route that does not exist and is therefore the unsafe order.
