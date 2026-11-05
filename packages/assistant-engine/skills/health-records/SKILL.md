---
name: health-records
description: Use in a private conversation before saving clinical documents and health files the member sends, such as lab reports, visit or discharge summaries, imaging reports, medication lists, allergy statements, PDFs, CSV or wearable exports, audio or video, and photos kept to track a body change over time. Meals use food-journal; blood type uses vault-cli profile.
---

# Health records the member sends

The resident saving rules decide whether to save. This skill says where each
kind of record goes and how to read the source.

## Where it goes

- Labs and panels: `blood-test`. Vitals and body values: `measurement`.
- Visits, assessments, plans, diagnoses, procedures, orders, imaging reports
  and test summaries: `encounter scaffold`, then `encounter import-json`.
- Current medicines and supplements: `regimen save` with the right kind,
  status and dates. Completed historical courses: `vault-cli medication
  history add`. One dose taken at a known time: `event medication-intake add`.
- Workouts: workout surfaces. Symptoms and body notes: symptom, event or
  Journal note surfaces.
- Raw evidence that cannot be structured yet: an existing document, capture,
  attachment, manifest or import surface, with the remaining parse state clear.
- Negative allergy statements such as NKDA, NKFA, "no known drug allergies",
  "no known food allergies" or "no known allergies": a
  `kind: "clinical_assertion"` event through `vault-cli event import-json` with
  `occurredAt`, `assertion`, `assertedOn`, and source context. Never create an
  allergy record for the absence of allergies or keep it only in memory.
- Recover the useful structure, mark uncertainty, and include provenance and
  confidence when the surface supports it. Lab values never live only in
  freeform memory when a structured path fits.

## Reading the source

- PDFs: use available local paths, extracted text, or rendered page evidence.
  As needed, use MIME checks, `pdfinfo`, `pdftotext -enc UTF-8 -nopgbrk`, and
  bounded `pdftoppm` rendering for only the pages needed. If no usable path,
  text or rendered page is available, say the PDF was not available rather
  than implying it was read.
- Voice memos, audio and video: use transcript fragments from ingestion. When
  they are missing and the task truly needs the media, use bounded local tools
  such as `ffmpeg` and Whisper (`whisper-cli`) if available.
- For substantial inspection or several parse and import steps, follow the
  progress-update rules before the long work. Skip progress for one-shot
  saves.

## Photos kept to track change

- A request to track progress photos, body composition, skin, acne or
  tretinoin, posture or form, or a wound or lesion over time is intent to keep
  the relevant images. Durable means canonical capture records with immutable
  `raw/captures/**` media and manifests; `raw/inbox/**` media is transient and
  may expire after 14 days.
- One observation or timepoint: `vault-cli capture add --media
  <readable-file-path> --collection <stable-series-slug> --format json` (repeat
  `--media` for several views of the same observation). Batches of distinct
  observations, body sites or timepoints: `vault-cli capture import-json
  --input @<payload.json> --format json`; run `vault-cli capture
  payload-schema --format json` first for the exact payload contract. Include
  stable labels, body sites, tags, notes and related ids when they help later
  retrieval.
- Pass real readable filesystem paths. If attachment metadata only exposes a
  vault-relative `raw/inbox/**` storedPath, resolve it under the active vault
  root first. If the media is missing, expired or unreadable, do not claim it
  was saved.
- Never use `mkdir`, `cp`, ad hoc experiment folders, memory, notes or
  experiment checkpoints as media storage. For an experiment, save captures
  first, then optionally append a checkpoint citing the returned capture event
  ids. Confirm a durable image save only from successful JSON that includes the
  capture ids, media and manifest fields.

## Large or mixed bundles

- Finish small, reply-needed extraction and saves yourself. A loaded skill may
  explicitly split independent canonical persistence from the durably accepted
  current input across bounded children. For a large or mixed bundle, preserve
  the source durably before replying. A child may write
  only its named family from that exact source, or enrich exact returned
  record ids, with idempotent, provenance-aware writes and dedupe.
- A spawn is not durable parse state. A short plain mention of the background
  work in the spawning reply is fine, but never promise completion. On later
  turns, do not call it pending, processing or in progress unless a durable
  owner proves that state. Claim child extraction only after canonical
  readback; otherwise say plainly which details you do not have yet, without
  bookkeeping words such as "unconfirmed" or "user-reported".
