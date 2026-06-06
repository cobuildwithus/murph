# Wearable Capture Helper

## Goal

Add a local-only helper that serves a browser page for consenting Oura, WHOOP,
and Garmin through Junction, then exports a sanitized JSON fixture candidate
from the captured local vault state.

## Constraints

- Do not commit raw provider payloads, tokens, account ids, direct user
  identifiers, or local machine paths.
- Keep the live capture vault and export under ignored `.runtime/tmp/**`.
- Keep the helper dev-only and out of production app routes.
- Prefer existing device-sync daemon/client APIs over new provider plumbing.
- Avoid active query-layer files currently owned by the Junction Oura RHR row.

## Current State

- Local capture helper, package script, sanitizer export, and focused tests are implemented.
- Device-sync HTTP/client owner id forwarding is implemented for Junction Link capture.
- Security/deep review findings for pseudonym derivation, owner id forwarding, Junction env readiness, sync waiting, timestamp shifting, and direct identity redaction have been fixed.
- Focused sanitizer, HTTP route, client wrapper tests, repo tools typecheck, repo-tool tests, and touched package typechecks pass.
- Re-audits, full verification, and commit are pending.

## Files

- `scripts/wearable-fixture-capture.ts`
- `scripts/wearable-fixture-capture.test.ts`
- `packages/device-syncd/src/http.ts`
- `packages/device-syncd/test/http.test.ts`
- `packages/operator-config/src/device-sync-client.ts`
- `packages/cli/test/device-sync-client.test.ts`
- `package.json`
- `tsconfig.base.json`

## Verification

- Focused script test.
- `pnpm typecheck`.
- Additional scoped checks if implementation touches package code.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
