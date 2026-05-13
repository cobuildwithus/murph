# Cloudflare Container SSH Key

## Goal

Allow local operators to add a personal `ssh-ed25519` public key to the rendered Cloudflare Containers config for Wrangler SSH debugging without committing key material.

## Constraints

- Do not commit SSH public keys, private keys, local usernames, home paths, or secret material.
- Keep the checked-in Wrangler scaffold free of operator-specific keys.
- Preserve generated deploy config as the canonical production deploy path.
- Use Cloudflare's current `ssh` / `authorized_keys` container config shape.
- Add process-namespace isolation when rendering SSH for the current pre-2026-04-01
  compatibility date.

## Plan

1. Add optional deploy-renderer env support for a container SSH public key and key name.
2. Validate that the configured key is `ssh-ed25519`.
3. Add focused tests for opt-in rendering and invalid key rejection.
4. Document the local-only key setup and Wrangler connect commands.
5. Set up/reuse a local key without printing key material.
6. Run focused Cloudflare verification and leakage checks.

## Verification

- `pnpm --dir apps/cloudflare typecheck` passed after security/final-review fixes.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/deploy-automation.test.ts test/container-rollout-config.test.ts test/container-image-contract.test.ts`
  passed after security/final-review fixes.
- Local Ed25519 key reuse was prepared through an ignored runtime env file
  containing only the stripped public key fields.
- Direct local config render with the ignored env file passed after fixes,
  including `containers_pid_namespace` and stripped key-comment checks.
- Scoped `bash scripts/workspace-verify.sh test:diff ...` reached
  `apps/cloudflare verify` and was stopped after waiting on an unrelated
  existing runner-bundle workspace lock; no task-specific failure was observed.
Status: completed
Updated: 2026-05-13
Completed: 2026-05-13
