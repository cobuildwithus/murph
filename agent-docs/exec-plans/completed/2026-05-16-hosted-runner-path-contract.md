# Hosted Runner PATH Contract

## Goal

Collapse hosted-runner command lookup into one owned executable PATH contract so
Codex direct command execution, non-login shells, and Docker startup see the
same shipped `murph` / `vault-cli` / native toolchain paths.

Success criteria:

- Hosted runtime child env always contains the image-owned executable PATH
  entries, with user/forwarded env still unable to override `PATH`.
- Hosted Codex config inherits only the already-constructed hosted runtime env
  through an explicit allowlist, matching Codex config semantics.
- Docker image correctness depends on Dockerfile `ENV PATH`, not profile scripts
  or login-shell side effects.
- Hosted runner smoke covers the non-login direct command path that failed in
  production.

## Constraints

- Preserve unrelated dirty work and active hosted-runner ledger rows.
- Do not forward provider credentials through Codex shell env allowlists.
- Do not let per-user or forwarded env set executable selectors or process
  control variables.
- Keep the fix narrow; avoid broad hosted-runner lifecycle changes.

## Plan

1. Add a single hosted runner executable PATH helper in assistant runtime.
2. Use that helper when projecting hosted child/process env.
3. Change hosted Codex config to inherit the constructed env with the same narrow
   allowlist and expose the policy constants to smoke tests.
4. Remove the Docker profile-script fallback and make the smoke probe non-login.
5. Update focused tests/docs and run required verification/audits.

## Verification

Planned:

- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-environment.test.ts hosted-runtime-codex-config.test.ts`
- `pnpm --dir apps/cloudflare test -- runner-child-launcher.test.ts container-entrypoint.test.ts container-image-contract.test.ts`
- `pnpm typecheck`
- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/environment.ts packages/assistant-runtime/src/hosted-runtime/codex-config.ts packages/assistant-runtime/src/hosted-runtime/codex-shell-env-policy.ts packages/assistant-engine/test/codex-authority-hard-cut.test.ts apps/cloudflare/src/container-entrypoint.ts apps/cloudflare/src/hosted-runner-smoke-child.ts apps/cloudflare/test/runner-child-launcher.test.ts apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/container-image-contract.test.ts Dockerfile.cloudflare-hosted-runner-base ARCHITECTURE.md packages/assistant-runtime/README.md`
Status: completed
Updated: 2026-05-16
Completed: 2026-05-16
