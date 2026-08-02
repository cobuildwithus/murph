# Physical Notes

## Status

Specified and implemented behind an explicit runtime capability, Lob
configuration, and a live-send kill switch.

## Product

Murph can mail one expressive, US-only physical note from a direct conversation
or a hosted group. GPT Image generates the complete color artwork page, including
any handwriting, illustration, and a small `murph ai` mark. Murph may show the
artwork first when a draft or choice is useful, but an explicit send request with
a complete or reliably resolved address may continue through generation and
mailing without an extra preview round trip.

A clear request to send a thank-you, congratulations, apology, or similar note
also supplies ordinary drafting intent. Murph uses the conversation to write
fitting short copy and asks about the message only when authorship, relationship,
signature, or meaning is materially ambiguous.

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

## Address completion

Omitted city, state, or ZIP fields are not automatically a conversational
blocker. Before asking for one of those objective details, the assistant may run
`vault-cli route resolve-address` against the exact US destination text already
supplied for the current note request. The command reuses the CLI-owned Mapbox
command surface and the existing Worker-owned provider-egress credential
boundary, requests at most three candidates, and persists neither the query nor
the response in Murph state.

The command returns a `recommendedCandidate` only when deduplication leaves one
candidate, the provider classifies it as a strong address result, the supplied
house number and street matched, any secondary-address component matched rather
than being extrapolated, and every field fits the existing physical-note
recipient schema. Any additional candidate, weaker component match, incomplete
US mailing field, or overlong send field leaves the recommendation empty and
requires one narrow clarification.

Address completion may fill only the destination the requester already supplied.
It cannot identify a recipient, discover where a person lives, choose between
genuinely ambiguous people or destinations, or authorize the mail effect. The
explicit accepted send request remains the sole model-facing authority for one
note.

## Ownership and persistence

Web owns the sole durable `HostedPhysicalNote` row. It stores only operational
facts: beneficiary, request identity and fingerprint, provider id, status,
complimentary offer code, configured provider cost, pricing version, and
timestamps. It never stores the postal address, image URL, artwork, prompt, or
note text.

The exact authorized input derives the request key. The artwork and recipient
remain in the separate request fingerprint, so reusing one approval with changed
content is a collision rather than a second effect. Before inserting a row, Web
validates the artwork lifetime, constructs the provider runtime, reasserts final
group authority, and observes caller cancellation. Accepted replays resolve
from the durable row even after the temporary artwork capability expires; an
existing uncertain send remains pending rather than being rewritten. Web then
admits a new provider effect under the member lock.

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

The existing Worker-owned hosted provider-egress boundary holds the real Mapbox
credential. The runner issues only the bounded CLI request through the
already-allowlisted Mapbox Geocoding path, so the real credential does not enter
the model prompt or workspace. The request uses `autocomplete=false` and
`permanent=false`, and its normalized result omits coordinates and provider
identifiers before returning to the assistant.

Web alone holds `LOB_API_KEY` and the configured return-address id. Lob receives
one color US Letter request using First Class mail, `insert_blank_page`, and a
provider idempotency key equal to the physical-note id. The generated artwork is
wrapped only in deterministic letter-sized transport HTML with the required
print-safe margin; visual expression remains model-owned.

Test keys may render proofs. A `live_` key is rejected unless
`LOB_PHYSICAL_NOTES_LIVE_ENABLED=true`. The charged amount comes from
`LOB_PHYSICAL_NOTE_COST_USD_MICROS` and its explicit pricing version, not from a
scraped public rate.

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

The proactive address-completion change ships in the runner bundle and reuses an
existing CLI command family plus the unchanged Worker-owned Mapbox provider-egress
credential boundary and allowlist. It adds no Web route, database schema, durable
state, or mixed-version protocol. Deploy the Cloudflare Worker and runner bundle
with the ordinary fingerprint convergence check; an older warm runner simply
retains the prior ask-for-address behavior.

The original physical-note deployment order remains: deploy the Prisma migration
and Web route/service first with live sending off, then deploy Cloudflare and the
assistant runtime/tool surface with `HOSTED_PHYSICAL_NOTES_ENABLED` still off.
Verify at least one Lob test-mode proof before enabling the Cloudflare capability,
and enable live sending only after that proof passes. The older runtime simply
lacks the tool during a Web-first compatibility window; a new runtime against an
old Web deployment would expose a route that does not exist and is therefore the
unsafe order.
