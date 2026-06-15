# Junction Direct Provider Link

## Goal

Make hosted/local Junction Link starts for a selected cloud provider, such as
Garmin, use Junction's direct-provider Link token path so the user lands on the
provider auth flow instead of a one-option Junction picker.

## Constraints

- Keep provider credentials, Link tokens, callback state, and user/provider ids
  out of logs, fixtures, docs, and committed output.
- Preserve generic multi-provider Junction Link sessions for flows that do not
  specify a source provider.
- Keep the change inside the existing device-sync provider/client seam; do not
  add a frontend workaround.

## Current Evidence

- Junction docs say `provider` on Link token creation dispatches directly to
  that OAuth provider; `filter_on_providers` only customizes the provider list.
- Current `JunctionClient.createLinkToken` serializes only
  `filter_on_providers`.
- Current `beginConnection` narrows selected sources to a single
  `filter_on_providers` value.

## Plan

1. Add a narrow Link-token `provider` option to the Junction client.
2. Pass the selected `sourceProviderSlug` as direct provider after validating it
   against the configured filter.
3. Update focused tests to prove generic sessions still use the allowlist and
   selected sessions send `provider`.
4. Run focused device-sync verification plus required completion reviews.

## Status

Implemented. Focused device-sync typecheck, tests, and coverage passed.
Repo-wide typecheck passed after preparing test runtime artifacts. The broader
`pnpm test:diff` lane reached unrelated `apps/web` verifier failures outside
this device-sync change.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
