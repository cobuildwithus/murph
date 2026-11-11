---
name: file-send
description: Sending a saved file, a newly made file, an export or a ZIP to the member in a private conversation with send_vault_file.
---

# Sending files from the vault

`send_vault_file` prepares one file for this conversation. The member approves
each send, and the runtime delivers the attachment. The tool never shows you
the file's bytes and cannot send to anyone else.

## Which ref to pass

- **A file that is already saved.** Pass its current vault-relative ref, for
  example `documents/report.pdf`. Do not copy or move it anywhere first.
- **A file you make for this request.** Once this turn has a request to send
  it now, write its final bytes straight to
  `.runtime/operations/assistant/generated-deliveries/<flat-filename>` and
  pass that ref. That folder is only for files being sent now. Do not put a
  file there in case it is wanted later, and never move or copy a saved file
  into it.

## Exports and ZIPs

To send several vault files, make a new ZIP. Read the originals where they are
and put only the new archive in the delivery folder.

When the member, in their own private conversation, asks for their whole
workspace:

1. Call `materialize_vault_media` with `all: true` before archiving, so media
   kept in cold storage is restored. It returns counts and any unavailable
   paths with reasons. Tell the member about unavailable paths and do not call
   the export complete. Unavailable means the file was not restored. Keep any
   local copy of it in the archive as unverified.
2. Archive every file under that member's workspace root as it is, including
   dotfiles, runtime and history, configuration and instruction files, and any
   records that hold credentials. This is the member's own data, so include it
   whatever its sensitivity. Keep bytes and relative paths unchanged, with no
   exclusion, redaction or cleanup based on content. Archive symlinks as links
   without following them, and read nothing outside the workspace. Leave out
   only the new ZIP itself.
3. Prepare the archive without asking the member to confirm the scope again.
4. Send only the new ZIP's delivery ref. The send limit is 100 MiB. Never drop
   files to fit under it. If the finished ZIP is larger, tell the member it
   cannot be sent.
5. When the ZIP contains `exports/packs/<packId>` directories, pass those
   exact pack ids in `retire_export_pack_ids`. Never list a pack that is not
   in the ZIP. Omit the field for every other file. The runtime retires those
   packs only after the delivery is confirmed.

A whole-workspace request covers that member's workspace only. It does not
cover another account, the wider host or a group, and it does not allow sending
without approval or to another destination.

## What the result means

- **`status: "pending"`.** Say that approval is needed and the file is not
  attached yet. The runtime adds the approval link itself, so never write or
  invent a link. Reply in text; do not call `finish_without_reply`.
- **`status: "approved"`.** The runtime delivers the attachment. Call
  `finish_without_reply`. Send no message alongside it and do not repeat the
  filename.

Say a file was sent only after the conversation shows it as a prior-delivery
attachment. Keep `deliveryStatus`, approval and queue details out of your
replies.

## After a pending send

The runtime owns a pending send until the conversation shows that file as
delivered. During that time do not list, recreate, rename, delete or overwrite
the file, and do not call `send_vault_file` for it again. When the member says
they approved it or asks whether it arrived, answer briefly in text: confirm it
was sent when the conversation shows delivery, and otherwise say it will come
through once approved.

When the member asks which files are still waiting for approval, or asks to
cancel one or all of them, use `murph.pending_vault_files` (find it with
`tool_search`). Its description covers listing, cancelling and what each
result means.

Once the conversation shows the file was delivered, a new request for that file
or a new export is a new send. Prepare it fresh and call `send_vault_file`
again. Never reuse an old approval link.
