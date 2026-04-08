# Replace synthetic hosted vault-cli artifact with published @murphai/murph package

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Replace the hosted runner's synthetic `@murphai/cloudflare-runner-vault-cli` staging artifact with the real published-shape `@murphai/murph` package while keeping `apps/cloudflare` and `@murphai/assistant-runtime` as the hosted runtime boundary.

## Success criteria

- The Cloudflare runner bundle installs `@murphai/murph` directly and no longer stages a dedicated hosted-only vault-cli artifact.
- Hosted `vault-cli` execution continues to resolve from the bundle's real package/bin layout.
- The bundle contract tests, docs, and architecture text all describe the published-package path rather than the synthetic artifact.
- Required verification for `apps/cloudflare` and repo typecheck/test acceptance passes, or any unrelated failure is explicitly documented.

## Scope

- In scope:
- `apps/cloudflare/package.json`
- `apps/cloudflare/scripts/runner-bundle-contract.ts`
- `apps/cloudflare/scripts/assemble-runner-bundle.ts`
- `apps/cloudflare/test/container-image-contract.test.ts`
- `apps/cloudflare/{README.md,DEPLOY.md}`
- `ARCHITECTURE.md`
- `pnpm-lock.yaml`
- Out of scope:
- Reworking hosted runtime ownership away from `@murphai/assistant-runtime`
- Removing or refactoring existing CLI command surfaces beyond what the published package path requires
- Unrelated hosted-runner warm-container/runtime changes already in flight

## Constraints

- Technical constraints:
- Keep `apps/cloudflare` as the deploy/runtime app boundary.
- Keep `@murphai/assistant-runtime` as the hosted execution surface; `@murphai/murph` is a leaf executable dependency only.
- Preserve the dirty worktree and avoid touching unrelated in-flight hosted-runner or hosted-web edits.
- Product/process constraints:
- Update durable architecture/deploy docs in the same change because this is a runtime/deploy boundary change.
- Commit only the exact touched paths with the repo commit helper after verification and audit.

## Risks and mitigations

1. Risk: Pulling in `@murphai/murph` directly could blur the hosted runtime boundary.
   Mitigation: Keep all runtime code paths on `@murphai/assistant-runtime`; use `@murphai/murph` only as an installed package/bin inside the bundle contract and document that explicitly.
2. Risk: The packed public CLI tarball could require extra workspace closure material beyond the old synthetic artifact.
   Mitigation: Verify the packed tarball shape and update the bundle contract/tests so the bundle installs the real package cleanly with deterministic local tarball overrides.
3. Risk: Existing dirty `packages/cli/**` edits could accidentally change the packed CLI shape.
   Mitigation: Limit this task to the bundle/deploy contract and document any residual dependency on the live local package contents in review and handoff.

## Tasks

1. Register the lane in the coordination ledger and capture the packaging reversal plan.
2. Replace the synthetic hosted vault-cli artifact contract with a direct `@murphai/murph` bundle dependency.
3. Update bundle assembly and contract tests to use the real package path.
4. Update architecture and deploy docs to describe the new packaging boundary.
5. Run required verification, complete the final audit pass, and commit the exact touched files.

## Decisions

- Use the real `@murphai/murph` package as a leaf installed dependency in the Cloudflare runner bundle instead of staging a hosted-only repackaged CLI artifact.
- Do not move hosted execution ownership into the CLI package; the runtime entrypoint remains `@murphai/assistant-runtime`.
- Build the full private workspace closure that the published `@murphai/murph` tarball bundles before packing it, and keep that closure under contract test so the bundle cannot silently drift from the published package shape.

## Verification

- Ran:
- `pnpm --lockfile-only install`
- `pnpm --dir apps/cloudflare verify`
- `pnpm --dir apps/cloudflare runner:bundle`
- `pnpm typecheck`
- `apps/cloudflare/.deploy/runner-bundle/node_modules/.bin/vault-cli --help | head -n 20`
- Outcomes:
- `apps/cloudflare verify` passed after the post-audit closure fix (`44` files, `407` tests).
- `apps/cloudflare runner:bundle` passed and assembled `.deploy/runner-bundle` with `@murphai/murph` installed as a dependency.
- The assembled bundle exposes and executes `vault-cli` directly from `node_modules/.bin`.
- `pnpm typecheck` passed.
- `pnpm test:coverage` failed for an unrelated pre-existing prepared-runtime contract in `scripts/build-test-runtime-prepared.mjs` that expects `packages/cli/src` to import `@murphai/assistant-cli/run-terminal-logging`; that failure sits in an already-dirty CLI lane outside this hosted-runner packaging change.
Completed: 2026-04-08
