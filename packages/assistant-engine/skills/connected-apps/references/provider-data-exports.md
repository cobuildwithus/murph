# Manual provider data exports

Read the top-level `../SKILL.md` first. This reference owns the fallback when a
member wants data from a health or fitness service that has no proven direct
Murph connection.

The routes below were checked against official provider documentation on
2026-08-09. Provider menus and migrations can change, so use the exact official
link in the matching entry and do not invent a replacement path from memory.

## Decision order

1. Prefer a real, currently advertised Murph connection. The trusted live
   provider list in the current prompt is authoritative. Do not call a provider
   supported or connected because it appears in this file.
2. If no direct connection is proven, use the matching official export route
   below.
3. If the provider is not listed here, do not guess a menu path or present a
   third-party article as authority. Say Murph does not have a verified direct
   route for it yet and offer to look for the provider's official export
   instructions.

## Handoff contract

- Give only the instructions for the provider the member named. Keep the reply
  short and put the official action URL on its own final line.
- The member performs the export in their own account. Never ask them to send a
  password, one-time code, recovery code, API key, or portal cookie.
- Ask for the original downloaded file as-is. Prefer it over screenshots,
  copied tables, or a reformatted spreadsheet because the original preserves
  more provenance and structure.
- Call this a manual export or one-time import, not a live sync. New readings or
  workouts require another export until Murph has a real direct connection.
- Do not promise a file type, date range, or complete-history guarantee that the
  provider does not document. Murph can inspect the actual file after the
  member sends it.
- Once the file arrives, follow the global health-record ingestion invariant:
  preserve the source and save recoverable facts to their canonical owners
  rather than ending with only a chat summary.
- In a group conversation, do not ask someone to upload private account data to
  the room. Ask them to continue in their private Murph conversation.

## Function Health

Function Health is a lab-testing service. Members can download completed lab
results as PDFs and send the PDFs to Murph.

Tell the member to open the Function documents page, download every relevant
`Lab Results of Record` PDF, and send the original PDFs to Murph. Naming
Function without supplying a file is not an import.

Function Health must remain user-operated. The `computer-use` skill explicitly
forbids automating Function login, portal navigation, record extraction,
downloads, or account actions.

https://my.functionhealth.com/documents

## Livongo / Teladoc Condition Management

Use this recipe only for Livongo or Teladoc `Condition Management` data such as
connected blood pressure, weight, glucose, diabetes, hypertension, or
weight-management history. A generic Teladoc request for virtual-visit notes,
encounter records, billing records, or other medical records is not this export
route.

Teladoc Health is the broader virtual-care company. Livongo was the connected
condition-management business; it became part of Teladoc Health in 2020. A
member may therefore see `Livongo`, `Teladoc Health`, or `Condition Management`
branding for the same condition-management program. Treat those names as
aliases only when the requested data belongs to that program, not for every
Teladoc record.

The official legacy export instructions are:

1. Sign in at `https://my.livongo.com`.
2. Click the member name in the upper-right corner.
3. Choose `Reports and Data`.
4. Choose the relevant report and click `Export`.
5. Send the downloaded original file to Murph without changing it.

For the normal legacy handoff, use the Livongo sign-in page as the user-facing
action link and put it alone on the final line. Do not make the member open the
help article first when the documented account flow is available.

https://my.livongo.com

The official legacy export article says the download contains all of the
member's data but does not state the file format, schema, timestamp semantics,
or how migrated accounts are represented. Never call it a CSV or promise
reading-level fields before inspecting the actual export. Use this article when
the member asks for the official instructions or source; it is not the normal
sign-in action link.

https://library.teladochealth.com/hc/en-us/articles/360044659034-How-to-Export-Your-Personal-Data-from-the-Secure-Livongo-Website

Some members now access existing Livongo programs through the Teladoc Health app
or website. The official migration FAQ tells members to sign in, choose
`Condition Management`, then choose `Go to programs`; it does not document an
equivalent export control for the newer experience. If the legacy `Reports and
Data` path is unavailable, do not invent another menu. Explain that no verified
new export path is documented, give the migration FAQ below as the fallback
action link, and tell the member to use any first-party export their account
shows or contact Livongo Member Support at `membersupport@livongo.com` or
`800-945-4355`.

Send exactly one action link: the Livongo sign-in page for the normal legacy
flow, or the migration FAQ only when the legacy path is unavailable.

https://www.teladochealth.com/start/new-experience-faq

This is a one-time snapshot, not continuous Teladoc sync. The member must export
again to refresh later readings. When the file arrives, inspect its real format
and use the narrowest existing measurement or health-record ingestion path; do
not infer blood pressure, weight, or glucose rows from an unsupported summary.

## Strong

Strong is a workout-tracking app. Its official export is a
spreadsheet-friendly CSV containing workout data.

- iPhone/iPad: open Strong, go to `Settings`, then choose
  `Export Strong Data`.
- Android: open Strong, go to `Settings`, then choose `Export Data`.
- Ask the member to send the exported CSV to Murph. Strong says the CSV cannot
  be imported back into Strong; do not imply that Murph changes their Strong
  account.

After the original CSV arrives, use the existing structured importer rather
than rebuilding workouts by hand:

```text
vault-cli workout import inspect <file> --vault "$VAULT" --source strong --format json
```

Run the write only when inspection says the file is importable:

```text
vault-cli workout import csv <file> --vault "$VAULT" --source strong --format json
```

Claim completion only from the durable import result. This imports historical
workouts; it does not keep Strong continuously synced.

https://help.strongapp.io/article/235-export-workout-data

## Hevy

The product name is `Hevy`; members may type or dictate `Heavy`. Hevy can export
workout history and body-measurement history separately.

Tell the member to open Hevy and go to:

`Profile` → `Settings` → `Export & Import Data` → `Export Data`

Then choose `Export Workouts` and, only when body measurements are relevant,
`Export Measurements`. Ask them to send the original exported file or files to
Murph. Do not make them export measurements when they only want workout
history.

For a workout CSV, inspect and import through the existing structured importer:

```text
vault-cli workout import inspect <file> --vault "$VAULT" --source hevy --format json
vault-cli workout import csv <file> --vault "$VAULT" --source hevy --format json
```

Run the write only when inspection says the file is importable. A Hevy
measurements export is not a workout CSV; do not send it through the workout
importer. Inspect its actual format and use the canonical measurement ingestion
path that fits it.

https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy
