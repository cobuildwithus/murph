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
  password, one-time code, recovery code, or portal cookie.
- Ask for the original downloaded file as-is. Prefer it over screenshots,
  copied tables, or a reformatted spreadsheet because the original preserves
  more provenance and structure.
- Call this a manual export or one-time import, not a live sync. New readings or
  workouts require another export until Murph has a real direct connection.
- Do not promise a file type that the provider does not document. Murph can
  inspect the actual file after the member sends it.
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

https://my.functionhealth.com/documents

## Teladoc Health / Livongo

Teladoc Health is the broader virtual-care company. Livongo was the connected
chronic-condition program for areas such as diabetes, hypertension, and weight
management; Livongo became part of Teladoc Health in 2020. The same member may
therefore see Livongo branding, Teladoc Health branding, or a Teladoc
`Condition Management` entry. Treat `Teladoc`, `Teladoc Health`, and `Livongo`
as aliases for this export path, not as separate device integrations.

The official export article currently directs the member to:

1. Sign in at `https://my.livongo.com`.
2. Click their name in the upper-right corner.
3. Choose `Reports and Data`.
4. Choose the report and click `Export`.
5. Send the downloaded file to Murph without changing it.

Some accounts are being migrated into the Teladoc Health app and website. If
the legacy sign-in does not work, explain the branding transition and send the
official article below; do not invent a different Teladoc menu path. The
article says the export downloads a file containing the member's data but does
not state the file format, so never call it a CSV before seeing it.

https://library.teladochealth.com/hc/en-us/articles/360044659034-How-to-Export-Your-Personal-Data-from-the-Secure-Livongo-Website

## Strong

Strong is a workout-tracking app. Its official export is a
spreadsheet-friendly CSV containing workout data.

- iPhone/iPad: open Strong, go to `Settings`, then choose
  `Export Strong Data`.
- Android: open Strong, go to `Settings`, then choose `Export Data`.
- Ask the member to send the exported CSV to Murph. Strong says the CSV cannot
  be imported back into Strong; do not imply that Murph changes their Strong
  account.

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

https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy
