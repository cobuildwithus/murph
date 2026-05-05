# Strava webhook signature hardening

Status: completed
Created: 2026-05-06
Updated: 2026-05-06

## Goal

- Close the Strava webhook spoofing finding by requiring provider-owned POST signature verification before Strava webhook payloads can enqueue device-sync work.

## Success criteria

- Strava `verifyAndParseWebhook` rejects POST deliveries without a valid `X-Strava-Signature`.
- Valid signed Strava activity and deauthorization payloads still parse into the existing jobs.
- The GET `STRAVA_WEBHOOK_VERIFY_TOKEN` subscription challenge flow remains unchanged.
- Junction, Oura, and WHOOP webhook behavior remains unchanged.
- Focused Strava provider/config tests and required repo verification/audits pass or have documented unrelated blockers.

## Scope

- In scope: Strava provider config/env plumbing, Strava signature verification, focused tests, and short docs for the new provider-owned secret.
- Out of scope: Junction webhook behavior, Strava subscription persistence, generic public-ingress response normalization, live Strava endpoint verification.

## Constraints

- Treat the signing secret as provider-owned secret config; do not serialize it into hosted runtime config.
- Keep the fix provider-local so local and hosted shared ingress both fail closed through the existing verifier boundary.
- Do not add new persisted state for this narrow spoofing fix.

## Risks and mitigations

1. Risk: direct Strava deployments without the new signing secret stop accepting POST webhooks.
   Mitigation: fail closed for security; Junction-backed deployments are unaffected, and direct Strava can set the provider-owned secret before enabling direct webhooks.
2. Risk: signature parser drift against Strava's header shape.
   Mitigation: cover `t=...,v1=...`, stale timestamp, missing header, and invalid digest in focused tests.

## Tasks

1. Add Strava webhook signing secret/tolerance config and keep it non-serializable.
2. Verify Strava `X-Strava-Signature` before parsing body or building jobs.
3. Add focused provider/config/docs regressions.
4. Run scoped verification, required audits, and commit through `scripts/finish-task`.

## Decisions

- Use Strava's signed POST header as the primary authority boundary.
- Leave `STRAVA_WEBHOOK_VERIFY_TOKEN` as GET subscription preflight/admin-only config.
- Do not change Junction because Junction already has its own signed webhook verifier and is the current production path.

## Verification

- PASS: `pnpm --dir packages/device-syncd typecheck`
- PASS: `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/strava-provider.test.ts test/config.test.ts test/provider-manifests.test.ts --no-coverage`
- PASS: `pnpm --dir packages/device-syncd test:coverage`
- PASS: `pnpm test:smoke`
- PASS: `git diff --check` for task files
- PARTIAL/BLOCKED: `pnpm typecheck` passed `packages/device-syncd` and then failed in unrelated hosted-web Linq test code from another active row.
- PASS: security/privacy, simplify, coverage-write, and final-review audit passes; no blocking findings remained.
Completed: 2026-05-06
