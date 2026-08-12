---
name: physical-notes
description: Generate and mail one expressive full-page Murph note through the existing image and physical-note tools.
---

# Physical notes

Use this flow only when a person explicitly wants Murph to send a real note in
the mail. The product is one US-only, one-artwork-page, color First Class note.

## Resolve before asking

Identify one recipient name, the US street address the person supplied, and
enough intent to make the note. Do not treat an address as incomplete merely
because city, state, or ZIP were omitted.

Before asking for an objective missing address component, run
`vault-cli route resolve-address "<address>" --country US --format json`. This
is a narrow temporary Mapbox lookup for completing the destination the person
already supplied. Use `recommendedCandidate` only when it is non-null; it means
one strong candidate preserved the supplied house number and street and supplied
all US mailing fields. Otherwise ask one concise question about the unresolved
delivery-critical detail. Never use address lookup to discover where a person
lives, choose among genuinely ambiguous people or destinations, or infer send
authority.

A clear request to send a thank-you, congratulations, apology, or similar note
already asks Murph to draft fitting short copy. Use a signature the requester
explicitly supplied or that is already established in their private direct
context; otherwise omit it unless the note genuinely needs one. In a group,
never use a room display label or another participant's identity as authorship
proof. Do not ask whether Murph should draft the note. Ask about content only
when the intended sender, relationship, signature, or message meaning is
materially ambiguous.

## Compose with the existing primitives

1. Confirm the recipient address is complete as supplied or safely resolved and
   the request contains enough intent to make the note.
   Murph's fixed return address is platform configuration. Never ask the person
   for a return address, invent one, or place one in tool arguments or artwork.
2. Call `murph.generate_image` with portrait size `1024x1536`, JPEG output,
   high quality, and the exact current authorizing message as `message_ref`.
   The generated image is the complete expressive page.
3. After generation starts, send one short truthful acknowledgement, such as
   “I’m making it now; I’ll confirm here if the printer accepts it.” The
   existing hosted image completion will wake this conversation when the saved
   image is ready; do not poll, sleep, schedule, or create an automation.
4. On that trusted completion turn, call `murph.send_physical_note` with only
   the recipient address. Trusted runtime code automatically binds the exact
   saved image and originating user message.
5. When Murph intentionally shows the generated note first, keep the exact
   trusted `ref` and `sha256` from the completion. After a later explicit send
   request, call `murph.send_physical_note` with those exact values as
   `image_ref` and `image_sha256`; runtime code re-reads and verifies the vault
   bytes before mailing. Also pass the exact current approving message as
   `message_ref`; do not infer approval from another participant or from
   whichever message happened to arrive last. Never invent or alter any of
   these values.

Do not attach or preview the image merely because it exists. When the
originating request already said to mail it and the address is complete or
safely resolved, send it automatically. Show the image first only when the
person requested a draft, the intended content is ambiguous, or Murph genuinely
needs their choice.

## Image prompt

The model owns the visual expression. It may create handwriting, doodles,
illustration, collage, a fake award, a comic, or another fitting single-page
design. Keep it personal and specific to the conversation.

Include these print constraints in the prompt:

- portrait full-page artwork on white 8.5-by-11-inch paper;
- all important text, faces, and marks within the central 86 percent of the
  page because the 1024x1536 image is cover-cropped to US Letter;
- a small understated `murph ai` mark somewhere unobtrusive;
- no mailing address, postage, envelope, QR code, tracking code, or provider
  branding inside the artwork;
- large enough lettering and contrast to remain legible in print.

The recipient address belongs only in `murph.send_physical_note`; never place
it in the image prompt. Trusted server code supplies the platform return
address.

## Authority and safety

One explicit mail request authorizes one note. A group request may originate
from any current activated participant; the group itself owns the free claim
and any later Murph-time cost.

Do not send bulk or repeated mail, international mail, anonymous threats,
harassment, fraud, impersonation, doxxing, illegal content, or a note that
claims to come from an uninvolved real person. Ask one concise question only
after the permitted lookup cannot uniquely resolve a delivery-critical address
field, or when send intent or note authorship is genuinely incomplete. Do not
ask the person to repeat retrievable city, state, or ZIP details or whether
Murph should draft a clear note request. Never ask for a return address.

Treat tool results literally:

- `accepted` means accepted for printing, not delivered. When it carries
  `prior_note_accepted`, say the earlier submission was accepted and this replay
  sent nothing else; do not call it paid or complimentary or state a cost
  because historical billing evidence is unavailable. Otherwise, when the
  result is paid rather than complimentary, state the returned Murph-time cost;
- `pending` means do not retry or claim mailing success;
- `insufficient_usage` means explain that the free note was used and more
  Murph time is needed;
- `failed` means it was not accepted for printing. Follow the returned safe
  failure reason and next-step note exactly. Never substitute Lob text, guess
  that a confirmed address was wrong, or retry without a new explicit request.

A physical-note rejection by itself is recovery evidence, not product-feedback
eligibility. Do not call `murph.submit_product_feedback` solely because the
printer result says the problem is on Murph's side, needs correction, or needs
investigation. The existing feedback policy still applies when the person's own
current input independently establishes eligible frustration or repeated
Murph-owned friction.
