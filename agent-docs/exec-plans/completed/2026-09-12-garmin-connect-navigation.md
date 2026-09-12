# Expose failed Garmin persisted-page navigation

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal and invariant

Make the existing wearable browser journey reject failed persisted-page loads
before checking connection state. Keep callback-owned ingestion, connected state
before and after reload, provider consent, and owned cleanup mandatory.

## Evidence and owner

The browser runner discards both navigation responses. A synthetic HTTP 503
page with connected markup can therefore be accepted, while an empty error page
waits for the full connection deadline and hides the HTTP failure. The existing
browser runner owns navigation and its failure stage; no product state changes.

## Scope and decisions

Extract the existing persisted-page proof and validate each response and final
origin/path before its existing state assertion. Use fixed error messages and
numeric HTTP status only. Keep one navigation and one reload, with the existing
timeouts and no retry. Add real Chromium coverage using synthetic pages.
This is a diagnostic correction; a protected live canary must establish the
underlying page-load failure and eventual canonical-ingestion outcome.

## Tasks

1. Reproduce rejected HTTP status and unexpected redirect acceptance.
2. Add navigation validation and separate reload stage; preserve success proof.
3. Run focused browser/unit tests, Web typecheck, and candidate review.
4. Complete scoped PR, required review/CI, merge, and inspect the protected canary.
5. Continue the provider investigation from the new evidence if the canary fails.

## Verification

- Before validation, the real Chromium tests rejected the old implementation:
  both HTTP 503 cases and the redirect were incorrectly accepted.
- After validation, 78 focused tests passed across the existing headed browser
  smoke and wearable browser unit suites, including four new browser cases.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm complexity:diff` passed; existing configuration and authorization
  hotspots are unchanged, and the extracted proof is below the threshold.
- Parent candidate review found no product, persistence, auth, or provider
  authority changes. Only fixed navigation diagnostics and stricter proof.
- Exact-head CI and required final review remain PR completion gates.
- The protected live canary remains required to identify the underlying load
  failure and establish canonical ingestion. This diagnostic patch does not
  claim that outcome or alter the provider flow to manufacture success.
Completed: 2026-09-12
