---
name: physical-notes
description: Generate and mail one expressive full-page Murph note through the existing image and physical-note tools.
---

# Physical notes

Use this flow only when a person explicitly wants Murph to send a real note in
the mail. The product is one US-only, one-artwork-page, color First Class note.

## Compose with the existing primitives

1. Collect one complete US recipient address and enough intent to make the note.
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
originating request already said to mail it and the address is complete, send
it automatically. Show the image first only when the person requested a draft,
the intended content is ambiguous, or Murph genuinely needs their choice.

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

The address belongs only in `murph.send_physical_note`; never place it in the
image prompt.

## Authority and safety

One explicit mail request authorizes one note. A group request may originate
from any current activated participant; the group itself owns the free claim
and any later Murph-time cost.

Do not send bulk or repeated mail, international mail, anonymous threats,
harassment, fraud, impersonation, doxxing, illegal content, or a note that
claims to come from an uninvolved real person. Ask one concise question when
the address or send intent is incomplete.

Treat tool results literally:

- `accepted` means accepted for printing, not delivered; when the result is
  paid rather than complimentary, state the returned Murph-time cost;
- `pending` means do not retry or claim mailing success;
- `insufficient_usage` means explain that the free note was used and more
  Murph time is needed;
- `failed` means it was not accepted for printing.
