# Group Join Consent Gate

## Goal

Make `/groups/join/[joinCode]` recover from missing or stale launch legal consent by showing the existing hosted legal consent card inline before the group join action.

## Constraints

- Preserve the existing launch consent gate in `acceptHostedGroupJoinTx`; joining always shares at least profile name and may share health projections.
- Do not weaken health-data or legal-consent checks.
- Keep the change scoped to the group join page/client and focused tests.
- Preserve unrelated working-tree changes in the current checkout.

## Approach

- Load sanitized launch consent status for authenticated viewers on the group join page.
- Render the existing compact `HostedLegalConsentCard` when launch consent is missing or stale.
- Refresh the server route after consent is accepted so the join form appears with current status.
- Add focused tests around the page-level gate and/or client behavior.

## Verification

- Focused app/web tests for group join consent behavior.
- Typecheck or the narrowest truthful web verification lane available for touched files.

Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
