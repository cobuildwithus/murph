# Physical Notes

## Status

Specified and implemented behind an explicit runtime capability, Lob
configuration, and a live-send kill switch.

## Product

Murph can mail one expressive, US-only physical note from a direct conversation
or a hosted group. GPT Image generates the complete color artwork page, including
any handwriting, illustration, and a small `murph ai` mark. Murph may show the
artwork first when a draft or choice is useful, but an explicit send request with
a complete or reliably resolved recipient address may continue through
generation and mailing without an extra preview round trip. The platform
supplies Murph's fixed return address; it is never collected from the person
sending the note.

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
boundary and requests at most three candidates. The command itself does not
cache or write the query or result into canonical vault or hosted-product state;
the normalized result remains ordinary assistant-turn context under the
runtime's existing conversation and checkpoint retention rules.

The command returns a `recommendedCandidate` only when deduplication leaves one
candidate, the provider classifies it as a strong address result, the supplied
house number and street matched, any secondary-address component matched rather
than being extrapolated, and every field fits the existing physical-note
recipient schema. Every supplied delivery component must survive the lookup:
city, state names or codes, the complete five- or nine-digit ZIP, and any unit,
suite, floor, or building value must agree with the candidate and the provider's
component match. Any additional candidate, weaker or conflicting component
match, incomplete US mailing field, or overlong send field leaves the
recommendation empty and requires one narrow clarification.

Address completion may fill only the destination the requester already supplied.
It cannot identify a recipient, discover where a person lives, choose between
genuinely ambiguous people or destinations, or authorize the mail effect. The
explicit accepted send request remains the sole model-facing authority for one
note.

## Ownership and persistence

Web owns the sole durable `HostedPhysicalNote` row. It stores only operational
facts: beneficiary, request identity and fingerprint, provider id, status,
complimentary offer code, configured provider cost, pricing version, one
provider-neutral failure reason, and timestamps. The failure reason is limited
to recipient address, artwork, service availability, invalid Murph request,
prior-note unresolved or accepted state, or unknown. It never stores the postal
address, image URL, artwork, prompt, note text, or Lob's freeform error message.

The exact authorized input derives the request key. The artwork and recipient
remain in the separate request fingerprint, so reusing one approval with changed
content is a collision rather than a second effect. Accepted replays resolve
from the durable row even after the temporary artwork capability expires; an
existing uncertain send remains pending rather than being rewritten. After that
replay check, Web treats every `starting` row as a member-wide unresolved-effect
guard. Replaying that same request key always returns pending without another
Lob create call, even if the temporary artwork URL changed. A distinct request
is first persisted as an unsent `prior_note_unresolved` row. Only that distinct
explicit request may, after the 23-hour provider window, reconcile the guarded
row through Lob's exact-metadata lookup. Recent or indeterminate evidence keeps
both rows blocked. Confirmed acceptance finalizes the guarded row, including
the original paid usage when applicable, narrows the current blocker to
`prior_note_accepted`, and creates no new provider effect. Confirmed absence
marks the guarded row and current blocker `unknown` and releases any
complimentary claim; the blocked request remains unsent, so only a later new
explicit request may enter ordinary admission.

The same blocker narrowing happens when the original provider call completes
after a distinct request has already committed its blocker. Ordinary acceptance
atomically moves every blocker created behind that in-flight member effect to
`prior_note_accepted`. A successful definite-rejection transition atomically
moves them to `unknown`, because the blocked requests may have different
recipients or artwork and cannot inherit the source rejection category. If the
rejection compare-and-set loses to acceptance, only the acceptance finalizer
settles the blockers. Exact blocker replay therefore never remains in the
present-tense unresolved state after the source reaches a terminal result.

`memberId + complimentaryOfferCode` atomically admits one complimentary note per
direct member or synthetic group member. A definite provider rejection releases
the promotional claim; an ambiguous outcome keeps the row pending and is never
blindly resent after Lob's idempotency window. Once admitted, the provider call
uses its own bounded timeout rather than caller cancellation, preventing a
durable reservation with no matching provider attempt.

For a definite rejection, Web maps only Lob's allowlisted structured error code
to the bounded failure reason and persists it before responding. Lob's
human-readable message is untrusted, may contain address details, and never
enters durable state or assistant context. Replays return the same safe reason.
A pre-migration failed row without one remains ambiguous because old Web also
terminalized HTTP 408. It joins current `starting` rows in the same
oldest-first, member-wide unresolved-effect guard. The member-locked admission
re-reads that guard instead of trusting a row selected before the lock and
repeats the same bounded check immediately
before ordinary reservation. Resolving one row can therefore never hide a
second unresolved row or admit another provider effect. A recent or
indeterminate same-key legacy replay stays pending. A different current request
is first recorded under its own request key as an unsent
`prior_note_unresolved` failure, then at most one older row is reconciled.
Proven absence narrows the current row to `unknown`. If an older legacy row is
proven accepted, Web restores it without another send or an unsupported
historical charge, and the current row is durably narrowed to
`prior_note_accepted`, so the reply says both that the earlier note is headed to
print and that the current request was not submitted, without claiming the two
requests share a recipient; it does not invite another send or promise an
automatic investigation or follow-up. Recovery also preserves
`prior_note_accepted` on the accepted legacy row for exact-row replay only; the
terminal accepted row is not an unresolved-effect guard and cannot suppress a
later separately authorized request. Accepted-row replay is read-only because
ordinary paid acceptance commits its usage in the same transaction, while
restored legacy acceptance must never reconstruct erased historical billing
evidence. An accepted replay carrying `prior_note_accepted` therefore says only
that the earlier submission was accepted and the replay sent nothing else; it
omits paid, complimentary, and cost claims. The blocked current request remains
terminal and replay-stable, while a later distinct request uses ordinary
access, complimentary, and paid-usage admission. The current reply and every
replay therefore identify the current row and cannot turn that suppressed
request into a new provider effect. The assistant tells the
person whether to check the address, regenerate the artwork, or wait for Murph
to fix its printing setup or request. It never guesses from an unknown reason
or retries an ambiguous outcome.

For paid notes, the same member lock and unresolved-effect guard admit at most
one `starting` physical note at a time. Distinct concurrent requests are
persisted as unsent blockers instead of reaching allowance admission. The
allowance gate can therefore compare the frozen provider cost directly with
the existing remaining balance; it needs no pending-cost aggregate or second
balance owner.

## Provider boundary

The existing Worker-owned hosted provider-egress boundary holds the real Mapbox
credential. The runner issues only the bounded CLI request through the
already-allowlisted Mapbox Geocoding path, so the real credential does not enter
the model prompt or workspace. The request uses `autocomplete=false` and
`permanent=false`, and its normalized result omits coordinates and provider
identifiers before returning to the assistant.

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

The proactive address-completion change ships in the runner bundle and reuses an
existing CLI command family plus the unchanged Worker-owned Mapbox provider-egress
credential boundary and allowlist. It adds no Web route, database schema, durable
state, or mixed-version protocol. Deploy the Cloudflare Worker and runner bundle
with the ordinary fingerprint convergence check; an older warm runner simply
retains the prior ask-for-address behavior.

The Cloudflare physical-note Web-control port preserves HTTP 408 as uncertainty
instead of translating it into a definite failed response. A gateway or caller
timeout can occur after Web consumed the POST and Lob accepted the note, so only
Web's categorized JSON response can authorize “nothing was sent” recovery copy.
Control-plane 408, transport failure, 5xx, and response-parse failure all throw
into the assistant's existing `pending` result with no retry invitation.

The original physical-note deployment order remains: deploy the Prisma migration
and Web route/service first, with live sending off.
Then deploy Cloudflare and the assistant runtime/tool surface with
`HOSTED_PHYSICAL_NOTES_ENABLED` still off. Configure Lob's fixed Murph return
address and enable USPS Secure Destruction in the Lob account. Verify at least
one Lob test-mode proof before enabling the Cloudflare capability. Set
`LOB_USPS_SECURE_DESTRUCTION_CONFIRMED=true` only after the account setting is
active, then enable live sending. The older runtime simply lacks the tool during
a Web-first compatibility window; a new runtime against an old Web deployment
would expose a route that does not exist and is therefore the unsafe order.

The additive actionable-rejection rollout is producer-first within the
already-live physical-note route: deploy Web's additive Prisma migration and
response producer before Cloudflare and the runner bundle. That installs Web's
HTTP 408 ambiguity correction before any recovery can authorize a later
explicit request. During the mixed-version interval an older strict runner
rejects a categorized failure response and the assistant fails closed to
`pending` without retry; responses without a definite printer rejection remain
unchanged.
Then deploy Cloudflare and the runner bundle with `container_rollout=immediate`
and require the managed-container smoke to prove the exact new runner-bundle
fingerprint. Verify one synthetic rejection category, provider-side and
control-plane HTTP 408 ambiguity,
one legacy-null resolution, and one accepted test-mode note after both sides
converge. Once current Web can persist categorized failures or the
`prior_note_accepted` no-send authority, that Web artifact is a hard rollback
floor. A normal recovery rolls Cloudflare back first and forward-fixes Web;
never roll Web below the floor while physical-note sending remains enabled.
If an emergency requires an older Web artifact, first disable
`HOSTED_PHYSICAL_NOTES_ENABLED`, converge and drain every runner that could call
the route, and keep the capability off until compatible Web and runner
artifacts are restored.
