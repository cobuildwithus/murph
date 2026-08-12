# dexcom-coming-soon

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Show the modern Dexcom integration as coming soon and prevent fresh production connection starts while preserving existing-account ingestion and the separate legacy G6 connection route.

## Success criteria

- The modern Dexcom card stays visible on `/connect` for signed-in and signed-out visitors with a disabled `Coming soon` action.
- The modern Dexcom source has no startable connect target, including when Junction is configured with `dexcom_v3`.
- Direct server-side starts for the modern Dexcom source fail closed through the shared source-availability gate.
- Existing connected or recovery-state Dexcom accounts remain visible and manageable, and only a live member-owned recovery state can restart authorization.
- The legacy `Dexcom (G6 and older)` route remains unchanged.
- Focused tests, desktop/mobile design-catalog proof, required review gates, and exact-head CI pass.

## Scope

- In scope: source availability gate, `/connect` card copy/action state, design-catalog state, focused regression coverage, public changelog entry.
- Out of scope: Dexcom credential provisioning, Junction plan changes, legacy G6 removal, sync ingestion changes, production deployment.

## Constraints

- Technical constraints: keep `dexcom_v3` configured for existing-account ingestion; reuse the shared source gate and card unavailable-state contract.
- Product/process constraints: do not promise real-time access; keep the unavailable state visible and honest; preserve disconnect and recovery controls for existing accounts.

## Risks and mitigations

1. Risk: UI-only copy could leave a direct API start path open.
   Mitigation: gate `dexcom` in the shared device-connect source availability owner and cover it directly.
2. Risk: treating Dexcom as setup-only could hide disconnect controls for existing accounts.
   Mitigation: keep connected and recovery branches authoritative, revalidate the exact established `dexcom_v3` recovery state before every start or link issuance, and apply the coming-soon action only to fresh unavailable cards.
3. Risk: the legacy G6 route could be disabled accidentally because both integrations share the Dexcom name.
   Mitigation: gate only the normalized `dexcom` source ID and assert `dexcom-g6-and-older` remains available and mapped.

## Tasks

1. Implement the shared Dexcom product gate and visible coming-soon card state.
2. Add focused provider, page, action-state, and design-study regression coverage.
3. Add the public changelog item after the PR number exists.
4. Run focused verification, capture desktop/mobile design proof, complete required reviews, and close the plan through the scoped commit path.
5. Remediate the accepted review finding that the initial shared gate also suppressed existing-account reauthorization across Web, claim-link, internal-link, CLI, and assistant reconnect paths.
6. Remediate the follow-up authority split so assistant recovery commands execute only from the same live reconnect state they advertise, and a successful Web disconnect immediately consumes the recovery-only target.
7. Replace the assistant-specific recovery vocabulary with the shared lower-layer recovery-state policy so newer connection errors are admitted and broader generic source errors remain guidance-only for modern Dexcom.

## Decisions

- Keep the `dexcom_v3` Junction route configured for status and ingestion; disable only fresh starts through the existing product gate.
- Leave `dexcom-g6-and-older` unchanged.
- Split fresh availability from existing-account recovery eligibility. Modern Dexcom recovery is allowed only after one exact database query proves the member owns an established Junction connection with a live `dexcom_v3` source and a reauthorization, token-refresh, or newer-sync-error state.
- Keep Strava closed for both fresh offers and recovery. Keep historical `connection_reset` handling unchanged because that state is Garmin-only and cannot apply to Dexcom.
- Retain assistant recovery, but derive its executable target from the same live reconnect notice used by the status prompt and re-read that state at tool invocation. Do not add persisted state or a second lifecycle owner.
- Treat local disconnect as the terminal transition for a recovery-only unavailable source: remove its target immediately while retaining ordinary fresh-connect targets for available sources.
- Own the exact recovery reasons in `device-syncd/public-account`: confirmed live source plus account reauthorization (excluding disconnect), exact token-refresh failure, or a connection error newer than its last completion. Web authorization and assistant prompt/tool interpretation must consume that policy; generic reconnect guidance must not grant modern Dexcom execution.

## Verification

- Passed: focused Web connect-page Vitest suite (101 tests), assistant status/phase suites (307 tests), device-syncd connect-target tests (7), Web/device-syncd/assistant-runtime typechecks, and frontend design-proof unit tests (10).
- Captured and inspected responsive design-catalog proof showing both the fresh `Coming soon` state and existing-account `Reconnect` state at 1440×1200 and 390×844 CSS viewports.
- Remaining: exact-head CI and final routed ReviewGPT remediation round.
- Expected outcomes: fresh modern Dexcom starts are impossible, the card visibly says `Coming soon` at desktop/mobile widths, existing-account controls remain, and the legacy route is unaffected.
