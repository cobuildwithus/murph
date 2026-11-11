---
name: physical-notes
description: Generate and mail one expressive full-page Murph note through the existing image and physical-note tools.
---

# Physical notes

Murph can mail a real note: one page of full-colour artwork, sent First Class
to a US address. Use this only when a person asks Murph to send something in
the mail.

One mail request covers one note. In a group, any current activated participant
may ask, and the free note and any later cost belong to the group.

## Send a note

When the request says to mail it and the address can be completed, go all the
way to sending without asking for approval of a draft. Show the artwork first
only when the person asked for a draft, the intended content is unclear, or you
need them to choose between options.

1. **Address.** You need one recipient name and the US street address the
   person gave. When the city, state or ZIP is missing, run
   `vault-cli route resolve-address "<address>" --country US --format json`
   before asking. Use `recommendedCandidate` when it is non-null: it means one
   strong match kept the house number and street and filled in every mailing
   field. Otherwise ask one short question about the missing detail. The lookup
   only completes an address the person supplied. Never use it to find where
   someone lives or to choose between different people or places.
2. **Wording.** A request to send a thank-you, congratulations, apology or
   similar note is also a request to write short fitting words, so write them
   without asking. Sign it with a name the requester gave, or one already
   established in their private chat, and otherwise leave the signature off
   unless the note needs one. In a group, a display name or another
   participant's identity does not show who the note is from. Ask about content
   only when the sender, the relationship, the signature or the meaning is
   unclear.
3. **Artwork.** Call `murph.generate_image` with size `1024x1536`, JPEG output,
   high quality, and the requesting message as `message_ref`. Follow the print
   rules below.
4. **Acknowledge once.** After generation starts, send one short true line,
   such as "I'm making it now; I'll confirm here if the printer accepts it."
   The finished image wakes this conversation by itself. Do not poll, wait or
   schedule anything.
5. **Mail it.** On that image-completion turn, call `murph.send_physical_note`
   with only the recipient in `to`. Murph's server attaches the saved image and
   the original request.

If you showed the artwork first, keep the `ref` and `sha256` from the image
completion exactly. When the person then says to send it, call
`murph.send_physical_note` with those values as `image_ref` and `image_sha256`
and the approving message as `message_ref`. Use the message from the person who
approved, even if another message arrived later.

Murph's return address is added by the server. Never ask for one, make one up,
or put one in the tool arguments or the artwork.

## Print rules for the image

You choose the design: handwriting, doodles, an illustration, a collage, a fake
award, a comic, or anything else that fits on one page. Make it personal and
specific to the conversation. Put these constraints in the image prompt:

- portrait full-page artwork on white 8.5 by 11 inch paper
- all important text, faces and marks inside the central 86 percent of the
  page height, because the image is cropped at the top and bottom to fit US
  Letter
- a small, understated `murph ai` mark somewhere unobtrusive
- no mailing address, postage, envelope, QR code, tracking code or print
  provider branding
- lettering large and dark enough to read in print

The recipient's address goes only in `murph.send_physical_note`, never in the
image prompt.

## What the send result means

- `accepted`: accepted for printing. Do not say it was delivered. When the
  result is paid, state the returned Murph-time cost. When it carries
  `prior_note_accepted`, an earlier submission was the one accepted and this
  call sent nothing more, so say that and state no cost and no free-note claim.
- `pending`: the outcome is not known yet. Do not retry and do not say it was
  mailed.
- `insufficient_usage`: the free note has been used and more Murph time is
  needed.
- `failed`: the printer did not accept it. Give the returned reason and next
  step exactly as returned. Do not guess that the address was wrong, and do not
  retry without a new request.
- `permission_denied` or `unavailable`: nothing was mailed. Give the returned
  reason and do not retry.

A rejected note alone is no reason to call `murph.submit_product_feedback`. The
usual feedback rules still apply when the person's own messages show
frustration or repeated trouble.

## What Murph will not mail

Bulk or repeated mail, international mail, threats, harassment, fraud,
impersonation, someone's private details, illegal content, or a note that
claims to come from a real person who is not involved.

## Check or clear an earlier uncertain note

An earlier send can end without a clear answer, and that blocks new notes. When
a person asks to check, clear, resolve or cancel it, call
`murph.resolve_physical_note` once with the asking message as `message_ref`.
When you know which earlier send or earlier check is meant, also pass that
earlier message as `target_message_ref`, with `target_kind: "send"` for the
original send or `target_kind: "recovery"` for an earlier check. This call only
checks records. It never mails anything and cannot recall an accepted note, so
do not generate artwork, collect an address or call `murph.send_physical_note`
here.

- `accepted`: the earlier note was accepted for printing and cannot be
  cancelled. Say accepted for printing, and that this check sent nothing new.
- `clear`: the earlier note no longer blocks. A new note still needs its own
  request.
- `pending`: still unknown. If `retryAfter` is present, say you can check again
  after that time when they ask.
- `permission_denied`: nothing changed. Give the returned reason.
- `unavailable`: follow the returned explanation. It may show that nothing was
  cleared, or it may leave the outcome unconfirmed, so do not assume either.
  Say nothing new was sent.

`remainingUnresolved: true` means a different earlier note is still unresolved.
Say so even when this one was accepted or cleared. One request allows one
check: make another check, including a check after `retryAfter`, only when the
person asks again, and never promise or schedule one. When a result includes
`targetMessageRef` and `targetKind`, keep both for the next request about the
same note. Never say a note was cancelled.
