# Freeform activity names on Web

Status: completed
Created: 2026-11-26
Updated: 2026-11-26

## Goal

Let recording-enabled clients choose an activity name, use the suggested recorder
and carry the name through private saves, Settings export and shared card titles.

## Implementation

- Gate the new HTTP endpoint with the existing recording capability. Advertise
  support in Home and feed. Check the current route capability on each classification.
- Admit new names before classification or publication. Keep durable decoding
  structural and preserve exact private-save and committed-post retries.
- Store a successful classification under a versioned HMAC. Check the shared
  cache before consuming the member's daily provider budget and read back the
  winning row after concurrent inserts.
- Give the mobile client shared Unicode cleanup and display fixtures. Use the
  name on every original recording card and the fixed kind label on hidden cards.

## Verification

- Local Vitest covered classification, failure and fallback, request envelopes,
  named and unnamed card revisions, private saves, publication and export. All
  407 tests in the Health wins unit and HTTP suites plus Game routes passed.
  The six PostgreSQL suites passed on a fresh migrated database.
- The prepared Web typecheck, Prisma schema validation and complexity check passed.
- A malformed JSON request exercised the parser error log. The private route
  now drops quoted input from the diagnostic and preserves the HTTP error code.
- Deploy the migration and compatible Web readers before releasing the native
  picker. Evaluate classifier accuracy on synthetic names in staging.
Completed: 2026-11-26
