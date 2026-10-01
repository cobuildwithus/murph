# Explain delivery retry and phone sync failures

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and scope

Explain missing provider evidence and add privacy-safe phone-sync diagnostics.
Current base already has Linq receipt/service classifications and nullable-service
retry handling; preserve that implementation. Historical provider values absent
from logs cannot be reconstructed from local code.

## Decisions and constraints

- Record phone-provider comparison before the expectation guard rejects a sync.
- Distinguish absent phone accounts, present but unusable accounts, and verified
  phones; record expectation kind and equality without phone values.
- Correlate requests using a purpose-specific hash of the authenticated member.
  Never log provider payloads, account IDs, contacts, tokens, or exception prose.
- Reuse the structured logger, best effort. No extra network/database calls,
  new persistence, access changes, retry changes, or production mutation.
- Internal observability only: no product UX or public changelog change.

## Tasks and verification

1. Inspect existing provider selection and failure logging: complete.
2. Add the pre-guard diagnostic and regression tests: complete.
3. Run phone-sync tests, web typecheck, focused lint, and complexity diff.
4. Review the full diff for privacy and unchanged authority, close this plan,
   and create a scoped local commit. Deployment remains separate.

## Evidence

- Phone-sync route tests: 20 passed, including real-selector absent/unusable
  cases, verified-phone mismatch, exact field inventory, privacy exclusions,
  and preserved success/failure when logging throws.
- Web typecheck and focused ESLint passed.
- Complexity guard passed: route maximum 17 to 20, no hotspots above 20.
- Full diff reviewed: no new I/O, raw identity logging, or authority changes.
- Documentation drift initially required its owner index update; index corrected.
- No deployment performed; new diagnostics take effect after deployment.
Completed: 2026-09-10
