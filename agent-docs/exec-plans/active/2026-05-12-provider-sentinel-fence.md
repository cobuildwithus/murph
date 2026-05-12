# Fail closed for known provider egress without sentinel credentials

Status: active
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Make known hosted provider egress fail closed unless the request matches the Worker-owned sentinel credential contract and has the required active runtime fence.

## Success criteria

- OpenAI `/v1/responses` and `/v1/models` return 403 instead of passthrough when the sentinel bearer token is missing.
- Mapbox allowed path families return 403 instead of passthrough when the sentinel query token is missing.
- Linq, Telegram, and WhatsApp known provider hosts also fail closed when the request does not match their sentinel path/header contract.
- Sentinel-bearing provider injection returns 401 unless the request has the bound user header and active runtime fence headers.
- Existing provider write surfaces keep using the stricter write-fence helper.
- Focused Cloudflare intercept tests, diff verification, and typecheck pass.

## Scope

- In scope:
- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/test/runner-egress-intercept.test.ts`
- `apps/cloudflare/README.md`
- Out of scope:
- Provider route deletion or broad outbound intercept cutover work.
- Any dependency or deployment configuration changes.

## Constraints

- Technical constraints:
- Keep the fix narrow and composable: use the existing provider intercept and runtime fence primitives; do not add a parallel auth scheme.
- Do not read Worker provider secrets until the runtime fence check has passed.
- Product/process constraints:
- Preserve unrelated dirty work and active hosted-runner plan rows.
- Do not expose personal identifiers, secrets, or full authorization headers in durable files or handoff output.

## Risks and mitigations

1. Risk:
   Provider runner requests that lack sentinel credentials or runtime fence propagation start failing.
   Mitigation:
   Update success tests to include the same bound-user and runtime fence headers that the production runner fetch wrapper is expected to attach.
2. Risk:
   Accidentally weakening write-side provider controls.
   Mitigation:
   Keep provider egress on the existing active write-fence validation primitive before Worker secret injection.

## Tasks

1. Add runtime read-fence authorization before OpenAI and Mapbox sentinel credential injection.
2. Fail closed on known provider hosts when sentinel credentials are missing or the request path is outside the configured provider base.
3. Update success tests to prove active fence validation and authority-header stripping.
4. Add negative tests proving missing-sentinel provider requests do not pass through.
5. Run focused verification, required audits, and create a scoped commit if not blocked by unrelated dirty work.

## Decisions

- Treat OpenAI model calls and Mapbox lookups as platform-governed provider egress and require the active write-fence validation primitive before Worker secret injection.
- Treat any request to a configured provider host as platform-governed egress: unknown hosts may still pass through during migration, but known provider hosts must match the sentinel contract.

## Verification

- Commands to run:
- `pnpm --dir apps/cloudflare test -- --runInBand`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts`
- `pnpm typecheck`
- Expected outcomes:
- All commands pass, or any unrelated pre-existing failure is documented with evidence.
