# Bind wearable canary login to the configured credentials

Status: active
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
- [ ] Parent review, privacy/complexity checks, final review, and exact-head CI.
- [ ] Run the protected-main Garmin canary with the configured login after the current run finishes.

A fresh login may encounter provider challenges previously hidden by cached
sessions. Report that boundary honestly; do not bypass it or accept empty data.

Focused Kernel and browser suites pass all 78 tests. The hosted Web typecheck,
logging guard, and complexity guard pass. The two existing browser-script
hotspots are unchanged; profile removal adds no branch or state. Live proof
remains pending and is separate from these synthetic boundaries.
