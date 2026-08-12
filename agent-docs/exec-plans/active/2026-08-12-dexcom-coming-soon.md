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
- Existing connected Dexcom accounts remain visible, continue ingesting, and retain Disconnect; reconnect attempts remain unavailable while the integration is coming soon.
- The legacy `Dexcom (G6 and older)` route remains unchanged.
- Focused tests, desktop/mobile design-catalog proof, required review gates, and exact-head CI pass.

## Scope

- In scope: source availability gate, `/connect` card copy/action state, design-catalog state, focused regression coverage, public changelog entry.
- Out of scope: Dexcom credential provisioning, Junction plan changes, legacy G6 removal, sync ingestion changes, production deployment.

## Constraints

- Technical constraints: keep `dexcom_v3` configured for existing-account ingestion; reuse the shared source gate and card unavailable-state contract.
- Product/process constraints: do not promise real-time access; keep the unavailable state visible and honest; preserve status, ingestion, and Disconnect for existing accounts.

## Risks and mitigations

1. Risk: UI-only copy could leave a direct API start path open.
   Mitigation: gate `dexcom` in the shared device-connect source availability owner and cover it directly.
2. Risk: treating Dexcom as setup-only could hide disconnect controls for existing accounts.
   Mitigation: keep the connected branch authoritative and apply the coming-soon action only when there is no active account to manage.
3. Risk: the legacy G6 route could be disabled accidentally because both integrations share the Dexcom name.
   Mitigation: gate only the normalized `dexcom` source ID and assert `dexcom-g6-and-older` remains available and mapped.

## Tasks

1. Implement the shared Dexcom product gate and visible coming-soon card state.
2. Add focused provider, page, action-state, and design-study regression coverage.
3. Add the public changelog item after the PR number exists.
4. Run focused verification, capture desktop/mobile design proof, complete required reviews, and close the plan through the scoped commit path.

## Decisions

- Keep the `dexcom_v3` Junction route configured for status and ingestion; disable only fresh starts through the existing product gate.
- Leave `dexcom-g6-and-older` unchanged.
- Do not add a recovery exception while modern Dexcom is unavailable. Review proved the existing exact-source preparation consumes retry eligibility before provider success and shared Junction errors cannot safely identify Dexcom in multi-source accounts. Existing accounts retain ingestion and Disconnect; all new or reconnect authorization starts fail closed.

## Verification

- Commands to run: focused device-syncd and Web Vitest suites; `pnpm test:frontend-design-proof`; targeted Web typecheck or diff-aware verification; Playwright design-catalog captures; exact-head CI and routed ReviewGPT checks.
- Expected outcomes: all modern Dexcom authorization starts are impossible, the card visibly says `Coming soon` at desktop/mobile widths, connected accounts retain status and Disconnect, and the legacy route is unaffected.
