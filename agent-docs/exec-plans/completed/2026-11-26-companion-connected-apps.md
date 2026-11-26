# Connected apps in companion Settings

Status: completed
Created: 2026-11-26
Updated: 2026-11-26

## Outcome

Give a signed-in member a catalog of personal apps, a provider sign-in URL and an exact-account removal action. Keep removal available after product access lapses. The iOS build owns presentation and refreshes the catalog after the callback.

## Work and proof

1. Share the provider list, completion times, connect intent and verified callback with the existing Web flow. Keep provider calls outside database transactions.
2. Bind each route to the native credential and refuse group containers. Scope account discovery to the member across toolkits and match removal by exact ID. Exercise cookie rejection, lapsed access, cross-member IDs, catalog ordering and write-policy copy.
3. Accept the two known app builds and return only a status hint and the verified toolkit. Replay success, failure and the existing Settings return.
4. Copy the ten catalog logos, update the security boundary and trace saved-plan eligibility after revocation. Run focused Web tests and typecheck, then hand off a draft PR.

## Decisions

Composio owns provider revocation. Morning Journal owns vault reconciliation. Upcoming-context projection reads the vault policy locally. Immediate removal of saved plans across those owners would require a separate communication path or a change to projection reads.

## Results

The three routes, native callback branch and ten matching logos are in place. All 182 tests across the six focused Web files passed. The Web typecheck, focused lint, complexity guard, documentation drift and gardening checks passed. Tests used synthetic sessions, a database harness and provider-shaped responses. Live OAuth and iOS rendering remain release verification.
Completed: 2026-11-26
