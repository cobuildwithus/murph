---
name: health-records
description: Where clinical documents and health files a member sends are saved, how to read them, and how to keep photos that track a body change. Meals use food-journal.
---

# Health records the member sends

Recover as much structure as the source supports, mark what is uncertain, and
record where each fact came from when the command has a field for it. A lab
value belongs in a lab record, never only in memory or a note.

## Where each kind goes

| What the member sent | Command |
| --- | --- |
| Lab results and panels | `vault-cli blood-test` (`scaffold` shows the payload for `import-json`) |
| Vitals and body values | `vault-cli measurement add` |
| Visits, assessments, plans, diagnoses, procedures, orders, imaging reports, test summaries | `vault-cli encounter scaffold`, then `vault-cli encounter import-json` |
| A medicine or supplement they take now | `vault-cli regimen save` with its kind, status and dates |
| A course of medicine that has ended | `vault-cli medication history add` |
| One dose taken at a known time | `vault-cli event medication-intake add` |
| An allergy | `vault-cli allergy save "<title>" --substance "<substance>" [--reaction "<reaction>"] [--criticality <low, high or unable_to_assess>] [--recorded-on <YYYY-MM-DD>]` |
| A statement of no known allergies (NKDA, NKFA, "no known drug allergies") | `vault-cli assertion save --assertion no_known_drug_allergies --domain allergy --asserted-on <YYYY-MM-DD> --source-label "<where it was stated>" --format json`. Also `no_known_food_allergies` and `no_known_allergies`. |
| A vaccination | `vault-cli immunization save "<vaccine name>" --occurred-at <date>` |
| Blood type | `vault-cli profile set --blood-type <type>` |
| Workouts | the workout commands |
| Symptoms and notes about the body | the symptom, event or Journal note commands |

Never create an allergy record for the absence of allergies.

When a source cannot be structured yet, keep the original through an existing
document, capture, attachment or import command, and tell the member which
parts are still unread.

## Reading the source

- **PDFs.** Use the local path, extracted text or rendered pages you have. As
  needed, check the file type and use `pdfinfo`,
  `pdftotext -enc UTF-8 -nopgbrk`, and `pdftoppm` for only the pages you need.
  If you have no usable path, text or page, say the PDF was not available. Do
  not imply you read it.
- **Voice memos, audio and video.** Use the transcript that came with the
  message. When there is none and the task needs the recording, use local
  tools such as `ffmpeg` and Whisper (`whisper-cli`) if they are installed.

## Photos kept to track a change

When a member asks to track progress photos, body composition, skin, acne or
tretinoin, posture or form, or a wound or lesion over time, they are asking
you to keep the images. Photos in `raw/inbox/**` are temporary and can expire
after 14 days. A capture record keeps the image permanently.

- One observation or point in time:
  `vault-cli capture add --media <readable-file-path> --collection <stable-series-slug> --format json`.
  Repeat `--media` for several views of the same observation.
- Several separate observations, body sites or dates:
  `vault-cli capture import-json --input @<payload.json> --format json`. Run
  `vault-cli capture payload-schema --format json` first for the payload.
- Add labels, body sites, tags, notes and related ids when they will help find
  the photos later.
- Pass a real, readable file path. If the attachment only gives a
  vault-relative `raw/inbox/**` path, resolve it under the active vault root
  first. If the file is missing, expired or unreadable, do not say it was
  saved.
- Confirm a save only from successful JSON that includes the capture ids,
  media and manifest fields.
- The capture commands are the only place these photos are stored. Do not use
  `mkdir`, `cp`, an experiment folder, memory, notes or an experiment
  checkpoint to hold them. For an experiment, save the captures first, and
  then a checkpoint can cite the returned capture event ids.

## Large or mixed uploads

Do small extractions and saves yourself. For a large or mixed upload, save the
original file first, so nothing depends on work that happens after your reply.
You may then hand separate record types to helper agents. Each helper writes
only the record type it was given, from that exact source, or adds detail to
record ids it was handed, and checks for existing records before writing.

You may mention the background work briefly in the same reply, without
promising when it will finish. Say a helper's records exist only after you
have read them back. Until then, tell the member plainly which details you do
not have yet, in ordinary words.
