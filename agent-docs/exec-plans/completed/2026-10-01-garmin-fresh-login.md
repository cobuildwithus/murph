# Bind wearable canary login to the configured credentials

Status: completed
Created: 2026-10-01

## Outcome and invariant

A wearable canary must authenticate the configured account instead of inheriting
an unrelated valid login from its previous browser profile. Canonical data proof,
consent, trusted authorization hosts, challenge handling, and cleanup stay intact.

## Evidence and owner

The existing Kernel browser restores and saves a fixed provider profile. Cleanup
clears only application cookies. Provider authorization can therefore bypass the
configured login fields. This is a proven identity-proof gap, not a proven cause
of empty Garmin data. The browser runner and its existing automation creation
method own the correction. Normal member computer browsers use a separate method.

## Smallest correction

Remove profile loading and saving from canary automation browsers. Kernel then
creates fresh session state. Keep existing headed stealth behavior, browser TTL,
tunnel lifecycle, credential filling, and cleanup. No new flags, state, providers,
or secrets are needed. Previously saved profiles are not deleted or reused.

## Verification and delivery

- [x] Verify Kernel request shape excludes saved profiles while member browsers retain them.
- [x] Verify browser lifecycle, authorization behavior, and cleanup with focused tests and typecheck.
- [x] Parent review, privacy/complexity checks, final review, and exact-head CI.
- [x] Run the protected-main Garmin canary with the configured login after the current run finishes.

A fresh login may encounter provider challenges previously hidden by cached
sessions. Report that boundary honestly; do not bypass it or accept empty data.

Focused Kernel and browser suites pass all 78 tests. The hosted Web typecheck,
logging guard, and complexity guard pass. The two existing browser-script
hotspots are unchanged; profile removal adds no branch or state. Protected-main
runs now verify fresh authorization, persisted connection, and
owned cleanup. The fresh-login correction is complete. Canonical ingestion still
fails on missing provider data; that separate outcome remains owned by the active
Garmin vault-proof plan.


## Completed evidence

PR 3963 merged as `3d2ba92f9035ea19a3be04450517c6d7086f32d9` after all
36 final-head CI checks passed (two skipped) and final ReviewGPT passed on the
exact authored head. Protected-main runs 36941606135 and 36947142069 completed
fresh Garmin authorization and cleanup. Their full twenty-minute data waits did
not find recent provider data; this correction does not claim to resolve that
separate provider-availability failure.
Updated: 2026-10-01
Completed: 2026-10-01
