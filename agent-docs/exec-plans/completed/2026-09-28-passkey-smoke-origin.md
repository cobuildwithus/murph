# Use a domain origin for passkey browser proof

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Goal and protected invariant

A browser proof using the shared smoke base URL can create a virtual passkey
with the served hostname as its relying-party id. Production authentication,
trust decisions, credentials and provider traffic remain outside this change.

## Smallest correction and scope

Use localhost for the existing shared smoke host variable, which already owns
the server bind address, health check and browser base URL. Remove the legacy
approval proof's per-test hostname rewrite. Exercise the actual configured base
URL with a virtual authenticator and a synthetic intercepted page.
Reuse committed Frog report `20260916161600-playwright-smoke-server` without
inventing an issue number while repository reconciliation remains pending.

## Verification outcome

- Real Chromium rejects the original IP hostname as a relying-party domain;
  the same new regression passes with the fixed config.
- The canonical smoke command launched its own localhost server, passed health
  readiness and completed the virtual-passkey regression in 24.6 seconds.
  No authentication endpoint or external service was contacted.
- Both existing viewport configuration tests passed. Scoped ESLint and complexity
  guard passed, with no current source hotspot above 20.
- Parent candidate review found no issues. Required external review and
  exact-head CI remain landing gates. No merge or deployment is claimed.
Completed: 2026-09-28
