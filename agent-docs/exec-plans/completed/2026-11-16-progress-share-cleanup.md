# Progress share cleanup floor

Status: completed
Created: 2026-11-16
Updated: 2026-11-16

## Outcome and ownership

PR A supplies deletion and export before PR B can create share pictures. The
locked share plan sections 11 and 12 control this lane. The previous uncommitted
work was ported into the authorized checkout, including untracked files, without
changing the source checkout or any storage guard.

Progress owns the member/award share row and sealed generated JPEG. No source
photo identity is persisted and no Progress-pic FK or cleanup coupling remains.
The game profile owns the current reference photo; changing it leaves made
pictures alone. Legal owns the Privacy choice and audit. Privacy denial and all
share retirement commit together under the member lock. Repeated denial adds no
audit but still purges retained keys. Account suspension precedes share purge,
picture purge and row/key cascades. A failed purge blocks successful deletion.

## Product UX and scope

Feature. Backend cleanup and export journeys are Ready: first denial, repeated
denial after failed purge, regrant without revival, account cleanup and export
racing retirement/session loss. Native presentation and deployed generation are
Hold for the integrator's release proof. No generation routes, native changes,
production mutations, live provider calls, ReviewGPT or merge belong to PR A.

The founder chose not to update the privacy policy or subprocessor register for
this feature (2026-11-16). Privacy off and account deletion remove made pictures.

The account export in this checkout was vault-only, with no Progress-pic export
path. Section 12 assigns share export here, so the existing passkey-approved
Settings export now streams the encrypted vault session and share records in one
response. The browser preserves the vault JSON and appends share metadata and
ready JPEGs. No new endpoint, capability, table or stored export was added.
Settings > Export vault requires this transport change. At most 10,001 rows are
read; overflow fails before effects. Media reads are serial with fresh session
and status checks, share-specific AAD and buffer clearing.

## Verification

- Full migration deployment into an isolated loopback test database: exit 0.
- Focused A tests: 266 tests in 12 files, exit 0. Final export rerun: 83 tests,
  exit 0. No real member data or live provider calls.
- PostgreSQL atomic denial/rollback, failed-purge replay, independent picture
  lifecycle and ownership cascades: five tests, exit 0.
- Web typecheck: exit 0; lint: exit 0 (existing unrelated warnings).
- Complexity: exit 0; existing bucketed-export hotspot is unchanged.
- Diff selector: SSH admission exit 1 because no worker target is configured;
  the documented local executor passed, exit 0: 16,171 Web tests, affected
  typechecks, lint, dev smoke and production build.
- Authored-content privacy scan and diff whitespace check: exit 0.

## Deployment and handoff

Apply the additive migration, deploy PR A, verify the exact Web deployment, and
drain predecessor functions before PR B can produce images. The existing Worker
Progress store is reused unchanged. PR A is the rollback floor while any shares
exist. No backfill, queue, generation retry or feature flag. The parent owns
ReviewGPT, deployment proof and merge. The public feature announcement belongs
with the native drawer release; this PR has no share producer or native caller.
Completed: 2026-11-16
