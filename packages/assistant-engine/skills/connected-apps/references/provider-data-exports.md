# Manual provider data exports

Use this page when a member wants their existing data from a health or fitness
service that Murph cannot connect to directly. Read
`$MURPH_ASSISTANT_SKILLS_ROOT/connected-apps/SKILL.md` first.

The steps below were checked against each provider's official documentation on
2026-08-09. Provider menus change, so use the exact official link in the
matching section and never describe a menu path from memory.

## Which route to use

1. If the list of supported wearable connections in your standing instructions
   includes the service, use that connection. A service appearing on this page
   does not make it supported or connected.
2. Otherwise use the matching section below.
3. If the service is not on this page, say Murph has no verified route for it
   yet and offer to look for the provider's official export instructions. Do
   not guess a menu path or present a third-party article as the authority.

## How to hand it off

- Give only the steps for the service the member named. Keep the reply short
  and put the official link alone on the last line.
- The member does the export in their own account. Never ask for a password,
  one-time code, recovery code, API key or cookie.
- Ask for the original downloaded file, unchanged. It keeps more detail than a
  screenshot, a copied table or a reformatted spreadsheet.
- Call it a manual export or one-time import. Newer readings or workouts need
  another export.
- Promise no file type, date range or complete history that the provider does
  not document. Murph can look at the real file once it arrives.
- When the file arrives, keep the source file and save its facts to the records
  that own them. A chat summary alone is not enough.
- In a group, ask the member to continue in their private Murph chat and do not
  ask anyone to upload account data to the room.

## Function Health

Function Health is a lab-testing service. Tell the member to open the Function
documents page, download every relevant `Lab Results of Record` PDF, and send
the original PDFs to Murph. Nothing is imported until a file arrives.

The member has to do this themselves. Murph never signs in to Function, browses
its portal, or downloads from it, even when asked.

https://my.functionhealth.com/documents

## Livongo / Teladoc Condition Management

Use this section only for Livongo or Teladoc Condition Management data, such as
connected blood pressure, weight or glucose readings and diabetes, hypertension
or weight-management history. A member may see the program called Livongo,
Teladoc Health or Condition Management. A request for Teladoc virtual-visit
notes, encounter records, billing records or other medical records is a
different thing and this section does not cover it.

The official export steps:

1. Sign in at `https://my.livongo.com`.
2. Click the member name in the upper-right corner.
3. Choose `Reports and Data`.
4. Choose the relevant report and click `Export`.
5. Send the downloaded file to Murph unchanged.

Give the Livongo sign-in page as the link, alone on the last line:

https://my.livongo.com

The official article says the download contains all of the member's data. It
does not state the file format, the fields, how times are recorded, or how
migrated accounts appear, so never call it a CSV or promise particular fields
before seeing the file. Give the article itself only when the member asks for
the official instructions or the source:

https://library.teladochealth.com/hc/en-us/articles/360044659034-How-to-Export-Your-Personal-Data-from-the-Secure-Livongo-Website

Some members now reach their Livongo program through the Teladoc Health app or
website. The official migration FAQ tells them to sign in, choose
`Condition Management`, then `Go to programs`. It documents no export control
there. When the `Reports and Data` path is missing, say that no verified export
path is documented for the newer experience, give the FAQ below as the link,
and suggest they use any export their account offers or contact Livongo Member
Support at `membersupport@livongo.com` or `800-945-4355`.

https://www.teladochealth.com/start/new-experience-faq

Send exactly one link: the sign-in page in the normal case, or the FAQ when the
`Reports and Data` path is missing.

When the file arrives, look at its real format and save readings through the
measurement or health-record path that fits it. Do not build blood pressure,
weight or glucose rows from a summary that does not contain them.

## Workout CSV rules for Strong and Hevy

Inspect the original CSV before writing anything. Inspection returns only fixed
summary fields and never the file's headers or rows, so do not open or quote
the CSV to diagnose a problem.

- **Units.** If inspection returns `requiresWeightUnit: true` or
  `requiresDistanceUnit: true`, ask one short question covering every missing
  unit. Explain that the weight answer applies to every unitless load in the
  file, including bodyweight, assistance and added weight. Never infer units
  from locale, exercise names or the size of the numbers. Inspect again with
  `--weight-unit lb|kg` and `--distance-unit m|km|mi` as confirmed.
- **Source.** If inspection returns `detectedSource: null`, ask which app made
  the export and inspect again with `--source strong|hevy`. Never assume
  Strong.
- **Write.** Run the import only when no unit question and no unsafe skipped
  row remains. Say it is done only from the import result and its counts.
  `lookupIds` and `ledgerFiles` are capped on purpose, so use the count and
  truncation fields and do not ask for every id. Importing the same file again
  reports the existing workouts as skipped and stores nothing twice.
- **Refreshed export.** Treat each new export as a complete snapshot. If Murph
  reports that an earlier session is missing or changed, stop and ask for a new
  complete export. Do not import the apparent replacement as another workout.
- **Wrong unit.** If the member says a confirmed unit was wrong, run the exact
  original CSV again with the corrected unit and `--correct-units`. Use that
  flag only after they confirm. It replaces the same imported workouts, needs
  the exact earlier file, and keeps the original timezone and everything that
  is not a unit.
- **Wrong source and wrong unit.** Fix the source first: run the exact CSV
  again with only the confirmed `--source`, and leave the unit options out,
  because Murph reuses the earlier units for that step. Then run it again with
  the confirmed source, the corrected unit and `--correct-units`. Keep these as
  two separate runs.
- If Murph reports that the correction overlaps exercises or sets the member
  has edited, stop and leave their edits in place.

## Strong

Strong is a workout-tracking app whose official export is a CSV of workout
data.

- iPhone or iPad: open Strong, go to `Settings`, then `Export Strong Data`.
- Android: open Strong, go to `Settings`, then `Export Data`.

Ask the member to send the exported CSV. The export does not change anything in
their Strong account. When it arrives, follow the workout CSV rules above with:

```text
vault-cli workout import inspect <file> --vault "$VAULT" --source strong --format json
vault-cli workout import csv <file> --vault "$VAULT" --source strong --format json
```

https://help.strongapp.io/article/235-export-workout-data

## Hevy

The app is called Hevy. Members sometimes type or dictate "Heavy". It exports
workout history and body-measurement history separately.

Tell the member to open Hevy and go to:

`Profile` → `Settings` → `Export & Import Data` → `Export Data`

Then choose `Export Workouts`, and `Export Measurements` only when they want
body measurements too. Ask for the original file or files. When a workout CSV
arrives, follow the workout CSV rules above with:

```text
vault-cli workout import inspect <file> --vault "$VAULT" --source hevy --format json
vault-cli workout import csv <file> --vault "$VAULT" --source hevy --format json
```

A Hevy measurements export is a different format. Keep it out of the workout
importer, look at what it contains, and save it through the measurement path
that fits.

https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy
