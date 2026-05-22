# Provider Egress Route Matrix

## Goal

Triple-check hosted runner provider egress routes beyond Linq, harden any credential-injection gaps found during the audit, and add focused regression coverage for allowed provider API calls.

## Scope

- Compare OpenAI, Mapbox, Telegram, WhatsApp, and any other hosted-runtime provider callsites against Cloudflare runner egress allowlists.
- Add focused tests for allowed provider route families that are not already matrix-covered.
- Require provider-specific credential sentinels before Worker-owned credential injection.
- Preserve existing fail-closed behavior for unsupported provider paths.

## Constraints

- Keep production changes narrowly scoped to confirmed provider-egress trust-boundary gaps.
- Do not broaden provider egress beyond repo-owned runtime callsites.
- Do not expose secrets, provider payloads, user identifiers, local paths, or raw credentials in tests, docs, logs, or handoff.

## Verification

- Focused `runner-egress-intercept` tests.
- Scoped Cloudflare diff verification when available.
- Typecheck unless blocked by an unrelated pre-existing failure.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
