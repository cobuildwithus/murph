# Signed callback JSON ownership

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Give authenticated Cloudflare-to-web JSON callbacks one narrow owner for bounded body reading, signature verification over the exact raw bytes, replay protection, and post-authentication JSON decoding.
- Delete the repeated route-local `read body -> verify same text -> parse JSON` sequence without changing route-specific validation or behavior.

## Success criteria

- The callback helper reads a bounded request body exactly once and verifies the signature before decoding JSON.
- Empty or whitespace-only authenticated bodies retain the existing empty-object behavior.
- Demonstrated exact-pattern routes consume the helper while their body limits, route-specific parsers, authority checks, and responses remain unchanged.
- Special-status, custom body-error, raw-response, and bodyless callback flows remain local.

## Constraints

- Preserve fail-closed signature, timestamp, key, member identity, and nonce-replay checks.
- Do not introduce a generic request framework or move route-specific parsing into the authentication owner.
- Exclude the legacy usage-gate route being removed by another PR and the reply-alias route with custom body-limit error mapping.

## Tasks

1. Add focused helper behavior coverage, including authentication-before-JSON-parse ordering.
2. Implement the narrow authenticated-JSON helper.
3. Migrate only exact duplicate callback routes.
4. Run scoped tests, type-aware diff verification, coverage review, final review, and PR review gates.

## Verification

- Focused callback-auth and migrated-route tests.
- `pnpm test:diff` for the changed web paths.
- Required `coverage-write` audit.
- ReviewGPT and PR CI on the exact pushed head.
Completed: 2026-07-15
