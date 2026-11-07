---
name: file-send
description: Use in a private conversation before calling send_vault_file to send a saved or newly made file, export or ZIP to the member, and on later turns when the member says they approved a file or asks whether it arrived.
---

# Sending files from the vault

- Use `send_vault_file` for requested attachments in this conversation. For an
  existing saved file, pass its current vault-relative ref directly; do not copy
  it into generated-delivery staging.
- For a newly generated file requested for sending now, write its final bytes
  directly to `.runtime/operations/assistant/generated-deliveries/<flat-filename>`
  and pass that ref. Never stage possible later sends or move or copy existing
  files there.

## Exports and ZIPs

- Export requested vault files. ZIPs may read originals in place; stage only
  the new archive.
- For an explicit full-workspace request in the member's authenticated private
  conversation, archive all files under that member's workspace root as-is,
  including dotfiles, runtime and history, configuration and instruction files,
  and any credential-bearing records present. Include contents regardless of
  sensitivity, preserving bytes and relative paths without content-based
  exclusion, redaction, or sanitization. Archive symlinks as links without
  following them or reading outside the workspace. Exclude only the newly
  created ZIP itself.
- This authorizes workspace-only access, not cross-account access, broader
  host access, or group disclosure. Prepare without further scope
  confirmation; submit only the new ZIP's generated-delivery ref through the
  existing hash- and destination-bound send approval for this conversation,
  never hidden source refs. The export request does not authorize automatic
  sending or arbitrary destinations.

## Results

- `status: "pending"`: say approval is required and the file is not attached
  yet; the runtime adds the exact approval link outside model context. Never
  invent or print a link, and do not call `finish_without_reply`.
- After a pending send, the runtime owns that exact file until prior-delivery
  attachment context confirms it was delivered. On later approval or
  confirmation turns, do not list, recreate, rename, delete, overwrite, or call
  `send_vault_file` again for the same send; let the runtime resume it.
- `status: "approved"`: the runtime owns the attachment delivery. Do not send a
  companion chat reply or repeat the filename; call `finish_without_reply`.
  Never expose `deliveryStatus`, approval or queue mechanics, or stock
  "delivery is not confirmed" copy; claim success only after later evidence
  says `sent`.

## Later turns

- Delivery evidence appears as a prior-delivery attachment in conversation
  context. Once it shows the file was delivered, a later request for that file
  or a new export is a new send: prepare it fresh and call `send_vault_file`.
  Never reuse an old approval link for a delivered file.
- When the member says they approved or asks whether a file arrived, reply
  briefly: confirm it was sent when context shows delivery; otherwise say it
  will come through once approved. Never call `finish_without_reply` on these
  confirmation turns.
