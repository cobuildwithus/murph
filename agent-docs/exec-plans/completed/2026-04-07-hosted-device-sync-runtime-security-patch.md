# Land watched security patch for hosted device-sync runtime parsing and metadata sanitization

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Land the applicable changes from the watched security-audit patch so hosted device-sync runtime updates use the shared parser, accept string error fields, and sanitize stored connection metadata at both parse and persistence boundaries.

## Success criteria

- Cloudflare runner-outbound device-sync requests use the shared `@murphai/device-syncd/hosted-runtime` request parsers instead of a duplicate local parser.
- Hosted device-sync metadata is sanitized before persistence in both the shared parser layer and the Cloudflare runtime-store write path.
- Hosted device-sync runtime parsing accepts string `lastErrorCode` and `lastErrorMessage` fields while keeping timestamp fields strict.
- Focused tests cover the parser and runtime-store sanitization paths, and repo-required verification for the touched surfaces is recorded.

## Scope

- In scope:
- `apps/cloudflare/src/device-sync-runtime-store.ts`
- `apps/cloudflare/src/runner-outbound/device-sync.ts`
- `apps/cloudflare/test/device-sync-runtime-store.test.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`
- `packages/device-syncd/src/hosted-runtime.ts`
- `packages/device-syncd/test/hosted-runtime.test.ts`
- Out of scope:
- Broader replay/monotonicity changes for authenticated runtime updates.
- Unifying all remaining hosted device-sync request parsing across the web app and Cloudflare.

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree edits and land only the returned patch intent that still applies to the current tree.
- Re-read overlapping Cloudflare/device-sync files before editing because adjacent hosted work is active in the repo.
- Product/process constraints:
- Follow the repo completion workflow for a security-sensitive repo change, including required verification and final audit.

## Risks and mitigations

1. Risk: Active hosted Cloudflare work could make the downloaded patch stale or partially redundant.
   Mitigation: Port the behavioral intent onto the current files manually instead of applying the artifact blindly.
2. Risk: Input-validation changes could accidentally relax timestamp validation too broadly.
   Mitigation: Keep the timestamp fields on `readNullableIsoTimestamp` and only move `lastErrorCode` and `lastErrorMessage` to nullable-string parsing.
3. Risk: Sanitization only at request parsing would still leave a persistence gap for internal callers.
   Mitigation: Add the runtime-store persistence sanitization and focused tests for both seams.

## Tasks

1. Update the shared hosted device-sync runtime parser to sanitize connection metadata and accept string error fields.
2. Switch Cloudflare runner-outbound device-sync handling to the shared parser exports and remove the duplicate local parser.
3. Sanitize metadata in the Cloudflare runtime-store persistence path, including seeded state.
4. Add focused tests for parser behavior and Cloudflare runtime-store sanitization.
5. Run required verification, complete the audit pass, and commit the touched files.

## Decisions

- Use a dedicated execution plan even though this is a patch landing because the touched surface is security-sensitive and crosses package/app boundaries.
- Treat the downloaded patch as behavioral intent, not as an authority to overwrite active Cloudflare code blindly.
- Keep Cloudflare runner-outbound device-sync handling on the shared parser seam, but reject `seed` on that untrusted runner path so the patch does not expand runner authority to mint new hosted connections.
- Prove Cloudflare write-path sanitization by decrypting and inspecting the raw persisted runtime snapshot in tests instead of reading back through the already-sanitizing snapshot parser.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/device-sync-runtime-store.test.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage`
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/hosted-runtime.test.ts --no-coverage`
- `node --input-type=module -e "import { parseHostedExecutionDeviceSyncRuntimeApplyRequest } from './packages/device-syncd/src/hosted-runtime.ts'; const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({ userId: 'user_123', updates: [{ connectionId: 'conn_123', localState: { lastErrorCode: 'TOKEN_REFRESH_FAILED', lastErrorMessage: 'Refresh token expired', lastSyncErrorAt: '2026-04-07T00:00:00.000Z' } }] }); console.log(JSON.stringify(parsed));"`
- Expected outcomes:
- `pnpm typecheck` failed for a pre-existing unrelated type mismatch at `packages/core/src/domains/events.ts(621,9)` during the workspace build phase.
- `pnpm test:coverage` failed immediately for the same pre-existing `packages/core/src/domains/events.ts(621,9)` type mismatch during `build:test-runtime:prepared`.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/device-sync-runtime-store.test.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage` passed.
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/hosted-runtime.test.ts --no-coverage` passed.
- The direct Node scenario check printed a parsed payload showing string `lastErrorCode` and `lastErrorMessage` preserved with the ISO timestamp field intact.
Completed: 2026-04-07
