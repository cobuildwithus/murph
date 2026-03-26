# Replace Hosted Onboarding WebAuthn With `webauthx`

Status: completed
Created: 2026-03-26
Updated: 2026-03-26

## Goal

- Replace the hosted onboarding passkey ceremony implementation in `apps/web` with `webauthx` while preserving the existing invite, challenge, session, and billing handoff behavior.
- Install the `webauthx` skill globally for future Codex use and record any runtime/docs changes required by the library swap.

## Success criteria

- `apps/web` depends on `webauthx` instead of `@simplewebauthn/browser` and `@simplewebauthn/server`.
- Hosted onboarding registration and authentication routes still expose the same high-level ceremony split: `options` then `verify`.
- Challenge storage stays short-lived, single-use, and bound to the invite/member/type path already in the app.
- Existing passkeys continue to verify after adapting stored key material to the format expected by `webauthx`.
- Focused hosted-onboarding tests cover the ceremony wrapper boundary and the repo checks are rerun.

## Scope

- In scope:
  - package dependency swap in `apps/web`
  - server/client ceremony wrapper migration
  - any small storage-format adaptation needed for public keys
  - targeted docs and tests
- Out of scope:
  - redesigning the onboarding UX
  - changing invite/session semantics beyond what the library migration requires
  - broad hosted control-plane refactors unrelated to passkeys

## Risks and mitigations

1. Risk: `webauthx` stores public keys in a different format than the current code.
   Mitigation: inspect the library types/source first, add explicit conversion helpers, and cover both registration and authentication with focused tests.
2. Risk: client request/response payload shapes change enough to break the current API routes.
   Mitigation: keep route contracts stable where possible and limit client changes to the browser ceremony callsites.
3. Risk: this overlaps active `apps/web` work.
   Mitigation: keep the diff narrow to passkey ceremony surfaces, read current file state before edits, and avoid unrelated hosted-onboarding rewrites.

## Tasks

1. Install the global `webauthx` skill and inspect the package API.
2. Replace the current hosted passkey wrapper module and client ceremony calls with `webauthx`.
3. Adapt service-layer persistence/verification for the new public-key and response shapes.
4. Add focused hosted-onboarding passkey tests and update any necessary docs/package metadata.
5. Run completion audits, required checks, and commit the exact touched files.

## Verification

- `pnpm review:gpt --preset simplify --dry-run`
- `pnpm review:gpt --preset test-coverage-audit --dry-run --no-zip`
- `pnpm review:gpt --preset task-finish-review --dry-run --no-zip`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Outcome

- Installed the global `webauthx` skill and swapped `apps/web` from `@simplewebauthn/browser` / `@simplewebauthn/server` to `webauthx`.
- Preserved the hosted onboarding route split (`options` then `verify`) and the existing invite/session lifecycle while changing stored challenges to hex so the server/client wrapper can pass deterministic `0x...` inputs through `webauthx`.
- Added focused adapter and service tests for hosted onboarding registration/authentication and documented the new `webauthx`-backed ceremony wrapper in `apps/web/README.md`.

## Verification results

- Passed: `pnpm review:gpt --preset simplify --dry-run`
- Passed: `pnpm review:gpt --preset test-coverage-audit --dry-run --no-zip`
- Passed: `pnpm review:gpt --preset task-finish-review --dry-run --no-zip`
- Passed: `pnpm --dir apps/web typecheck`
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-passkeys.test.ts apps/web/test/hosted-onboarding-service-passkeys.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm --dir apps/web test`
- Passed: `pnpm typecheck`
- Failed outside this slice: `pnpm test` due unrelated `packages/cli` suite regressions in `assistant-cli.test.ts` and `incur-smoke.test.ts`
- Failed outside this slice: `pnpm test:coverage` due unrelated shared `packages/cli` build / runtime regressions (for example `packages/cli/tsconfig.build.json` source-boundary errors plus broad `assistant-cli`, `runtime`, `health-tail`, and `inbox-cli` failures)
Completed: 2026-03-26
