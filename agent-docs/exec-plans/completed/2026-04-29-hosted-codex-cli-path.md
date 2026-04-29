# Hosted Codex CLI Path

## Goal

Make hosted Codex-managed shell commands inherit the sanitized runtime environment that already includes the Murph CLI bin directories, so `vault-cli` and `murph` resolve inside hosted assistant turns.

Success criteria:
- Hosted Vercel AI Gateway Codex config opts Codex shell commands into inheriting the sanitized process environment via an explicit allowlist.
- Existing secret stripping remains intact; config contains env var names, not credential values.
- Focused assistant-runtime and assistant-engine tests cover the config and PATH projection assumptions.
- Hosted runner smoke regression proves Codex honors a hosted-style shell environment policy by resolving `vault-cli`/`murph`, inheriting `VAULT` and parser command env, and excluding provider credentials.

## Constraints

- Preserve unrelated dirty work.
- Do not touch the hosted runner Docker image or Codex CLI installation lane.
- Do not touch runner-bundle export fixes.
- Coordinate with the design-only native Codex file-injection row that lists `codex-config.ts`.
- Do not expose personal identifiers, secrets, or raw credential values.

## Current State

Focused implementation and regression coverage are complete. The hosted Codex config now writes `[shell_environment_policy]` with `inherit = "all"` and an `include_only` allowlist containing `PATH`, `VAULT`, `WHISPER_COMMAND`, and other non-secret runtime keys while excluding provider credential values.

## Completed Work

1. Added hosted Codex `shell_environment_policy` config for sanitized env inheritance.
2. Extended focused tests for generated config and hosted CLI PATH projection.
3. Added hosted runner smoke regression proof through a Cloudflare-local hosted-style Codex config and `codex app-server` `command/exec` probe, avoiding a public assistant-runtime export just for smoke reuse.
4. Ran focused package verification and required close-out audits.

## Verification

Passed:
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-codex-config.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-cli-access.test.ts --config vitest.config.ts --no-coverage`
- `pnpm exec vitest run apps/cloudflare/test/hosted-runner-smoke-contract.test.ts apps/cloudflare/test/hosted-runner-smoke.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage`
- `git diff --check` scoped to touched files

Blocked:
- `pnpm --dir apps/cloudflare test:e2e:linq-webhook:local` stops during runner bundle build in `@murphai/health-commons build` on a pre-existing invalid relation target before Vitest starts.
- `pnpm --dir packages/assistant-runtime typecheck` and `pnpm --dir apps/cloudflare typecheck` stop in unrelated dirty assistant-engine provider/redaction files.
- `pnpm typecheck` stops in `packages/vault-usecases` because it cannot resolve `@murphai/core` types in the current dirty workspace state.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
