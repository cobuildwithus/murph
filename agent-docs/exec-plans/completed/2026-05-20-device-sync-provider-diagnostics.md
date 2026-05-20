# Device Sync Provider Diagnostics

## Goal

Add provider-agnostic, metadata-only diagnostics to device sync failures so
WHOOP and the other provider paths surface the actual safe provider error reason
and request shape without logging credentials, tokens, raw URLs, raw IDs,
request bodies, or response bodies.

## Scope

- `packages/device-syncd/src/**`
- `packages/device-syncd/test/**`
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts` if contract
  propagation needs it
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`
- `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`
- `apps/web/test/device-sync-hosted-runtime-authority.test.ts`
- focused device-sync docs

## Constraints

- Keep the diagnostics failure-only and metadata-only.
- Do not log raw tokens, client secrets, auth codes, authorization headers,
  provider account IDs, raw provider paths, raw query values, request bodies,
  response bodies, local paths, emails, or phone numbers.
- Preserve the existing WHOOP OAuth diagnostic fields for compatibility while
  adding generic provider fields that all provider clients can emit.
- Prefer one shared helper layer over provider-specific ad hoc logging.
- Preserve unrelated dirty worktree edits.

## Plan

1. Add a shared provider diagnostic helper for safe endpoint, auth, parameter,
   response-shape, and sanitized provider error reason metadata.
2. Wire OAuth token, bearer API, and Junction request failures through that
   helper while replacing raw path messages with semantic endpoint kinds.
3. Extend service failure summaries, hosted runtime contracts, and web
   redacted runtime logs to allowlist the new fields.
4. Add focused tests proving useful failure metadata is captured and sensitive
   request/response material is omitted.
5. Run scoped package tests, repo typecheck, privacy/audit checks, and finish
   with a scoped commit if no unrelated overlap blocks it.

## Verification

- `pnpm --dir packages/device-syncd typecheck` passed after core wiring.
- `pnpm --dir packages/device-syncd test -- shared-oauth.test.ts whoop-provider.test.ts oura-provider.test.ts junction-provider.test.ts service.test.ts hosted-runtime.test.ts` passed; the package test runner executed the full device-syncd suite.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir apps/web typecheck:prepared` passed.
- `pnpm --dir packages/assistant-runtime test -- hosted-device-sync-runtime.test.ts hosted-runtime-maintenance.test.ts` passed; the package test runner executed the full assistant-runtime suite.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/device-sync-hosted-runtime-authority.test.ts` passed.
- `pnpm --dir apps/web test -- device-sync-hosted-runtime-authority.test.ts` is blocked by an unrelated dirty pitch-page expectation mismatch: the test expects `01 / 12`, while the rendered dirty working tree shows `01 / 13`.
- `pnpm --dir packages/device-syncd test:coverage` passed.
- `pnpm --dir packages/assistant-runtime test:coverage` passed.
- `pnpm --dir apps/web lint` passed with the pre-existing unused-destructure warnings in `apps/web/src/lib/device-sync/agent-session-service.ts`.
- `git diff --check -- <device-sync diagnostics files>` passed.
- `pnpm typecheck` and `bash scripts/workspace-verify.sh test:diff <device-sync diagnostics files>` are blocked by an unrelated dirty repo-tools TypeScript error in `scripts/clean-hosted-web-workflow-artifacts.test.ts`: a relative import is missing a NodeNext `.js` extension.
- Manual source diff review passed for the provider diagnostics helper, provider call sites, service failure shaping, hosted-runtime parsers, and log allowlists.
- Scoped privacy scan passed for the production source/docs diff: diagnostics expose semantic endpoint/request/response metadata and sanitized provider reason text, not raw credentials, auth headers, provider paths, query values, request bodies, response bodies, or provider account identifiers.

## State

- Shared provider diagnostics are implemented for OAuth token requests, direct bearer API requests, and Junction provider-config requests.
- Service, hosted runtime contract parsing, assistant-runtime maintenance logs, and web hosted-runtime logs allowlist the new safe diagnostic fields.
- Focused provider and runtime tests have been added and verification is complete except for unrelated dirty-worktree blockers noted above.
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
