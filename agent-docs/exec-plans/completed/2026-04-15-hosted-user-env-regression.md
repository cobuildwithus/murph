# Fix hosted user env access without activation crypto

Status: completed
Created: 2026-04-15
Updated: 2026-04-15

## Goal

- Restore hosted user-env control behavior for users who have not yet been through
  `member.activated`, without reintroducing broad signup warmups or duplicate crypto ownership.

## Success criteria

- `GET /internal/users/:userId/env` returns an empty configured-key list instead of failing when the
  user has no managed crypto envelope yet.
- Any required hosted user-env write path still works correctly for unactivated users without
  reviving the removed web-side warmup architecture.
- Focused Cloudflare tests reproduce the regression before the fix and pass after the fix.
- Required repo verification for the touched owners passes.

## Scope

- In scope:
  - Cloudflare hosted user-env read/write behavior for missing-envelope users.
  - Web control-plane assumptions that call the hosted user-env control surface during onboarding.
  - Regression tests covering missing-envelope control flows.
- Out of scope:
  - Separate hosted activation latency tuning beyond this regression.
  - Unrelated hosted finalize/retry behavior.

## Constraints

- Technical constraints:
  - Keep Cloudflare as the correctness owner for activation-time managed crypto.
  - Do not reintroduce broad web signup warmups or post-commit provisioning.
  - Preserve fail-closed runtime access for actual hosted execution paths.
- Product/process constraints:
  - Fix must be minimal and align with the simplified architecture landed earlier today.

## Risks and mitigations

1. Risk: A quick fix could accidentally make hosted runtime paths auto-bootstrap crypto too broadly.
   Mitigation: Limit the missing-envelope fallback to the hosted user-env control surface and keep
   runtime execution on `requireUserCryptoContext()`.
2. Risk: User-env writes may need explicit provisioning semantics while reads should not.
   Mitigation: Reproduce both read and write paths and cover each behavior with focused tests.

## Tasks

1. Reproduce the missing-envelope failure from the new Cloudflare log against current code/tests.
2. Patch hosted user-env control behavior so missing-envelope users are handled intentionally.
3. Add focused regression coverage for the reproduced failure mode.
4. Run required verification and summarize whether more production logs are still needed.

## Decisions

- Keep activation-time managed crypto ownership in Cloudflare runtime dispatch only; do not
  reintroduce signup warmups or generic pre-activation provisioning in web.
- Treat hosted user-env control as a separate control surface from runtime stores:
  - status reads return an empty key list when no managed crypto envelope exists yet
  - writes lazily ensure the managed crypto envelope only when the requested update would persist a
    non-empty hosted user env
  - runtime execution paths continue to use fail-closed `requireUserCryptoContext()`

## Verification

- Commands to run:
  - Focused `vitest` for touched Cloudflare coverage.
  - `pnpm test:diff` for the touched files.
  - `pnpm typecheck`.
- Expected outcomes:
  - Regression tests fail before the patch, pass after it, and no unrelated owner checks regress.
- Results:
  - Reproduced pre-fix failure with:
    `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner.test.ts --testNamePattern "returns an empty hosted user env status before managed crypto exists|bootstraps managed crypto on first hosted user env write"`
    Both targeted tests failed before the patch with `Hosted user root key envelope ... is missing`.
  - Focused post-fix checks passed:
    - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-key-store.test.ts apps/cloudflare/test/user-runner.test.ts`
    - `pnpm exec vitest run --config apps/cloudflare/vitest.workers.config.ts --no-coverage apps/cloudflare/test/workers/runtime.test.ts`
  - Owner-level diff verification passed:
    - `pnpm test:diff -- agent-docs/exec-plans/active/COORDINATION_LEDGER.md apps/cloudflare/src/user-key-store.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/workers/runtime.test.ts`
  - Root typecheck passed:
    - `pnpm typecheck`
Completed: 2026-04-15
