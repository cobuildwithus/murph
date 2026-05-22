# Hosted Vault CLI PATH Debug

## Goal

Diagnose why the live hosted assistant still cannot resolve bare `vault-cli`
even though the deployed container smoke passed, then patch the actual
assistant-turn PATH propagation gap if confirmed.

## Constraints

- Do not expose local paths, user identifiers, raw vault contents, prompts,
  provider payloads, credentials, or full environment dumps.
- Preserve unrelated dirty worktree edits and active hosted runner work.
- Keep diagnostics metadata-only: PATH membership booleans/counts are allowed,
  raw secret-bearing env values are not.
- Do not push or deploy unrelated local commits.

## Investigation Plan

1. Compare the deployed smoke route with the real hosted assistant turn path.
2. Inspect production observability for version/container evidence and sanitized
   PATH/runtime metadata around the failing probe.
3. Patch the narrowest runtime/assistant-engine PATH propagation seam that can
   explain a restricted real turn env.
4. Add regression tests that start from a restricted hosted PATH and require
   bare CLI discovery.
5. Run focused verification plus a direct deploy-smoke or local final-image
   proof, then decide the safe deploy path.

## Findings

- Production observability showed hosted workspace invocations on the deployed
  Worker version and a version-suffixed runner container, so the live failure is
  not explained by traffic stuck on an old unsuffixed container.
- The existing deploy smoke exercises Codex App Server `command/exec`, which
  inherits the app-server config environment directly.
- Real hosted assistant shell commands can run through Codex thread/user shell
  execution. That path sources the cached shell snapshot before the command and
  reapplies only explicit `[shell_environment_policy.set]` overrides.
- Hosted config previously allowed `PATH` through `include_only` but did not set
  it explicitly, so a snapshot captured from the base shell could restore the
  reduced system PATH and hide `/app/node_modules/.bin`.
- The deploy smoke config now mirrors the explicit hosted PATH override. Its
  temporary smoke-vault fixture was also renamed away from canonical vault-root
  naming so the canonical mutator audit treats it as a fixture, not a user vault
  writer.

## Verification

- `pnpm --dir packages/assistant-runtime test hosted-runtime-codex-config.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm typecheck`
- `pnpm --dir packages/cli test canonical-write-source-audit.test.ts`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir apps/cloudflare test:node container-entrypoint.test.ts`
- `pnpm test:diff`

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/**`
- `apps/cloudflare/src/container-entrypoint.ts`
- `packages/assistant-engine/src/assistant-cli-access.ts`
- `packages/hosted-execution/src/**` only if a shared hosted PATH constant is
  needed
- Focused tests for the touched owners
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
