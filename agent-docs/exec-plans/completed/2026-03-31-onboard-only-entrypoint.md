# Remove root setup command in favor of onboard

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Remove the root `setup` command and make `onboard` the only public onboarding/setup entrypoint across the CLI, package scripts, and repo docs.

## Success criteria

- `murph`/setup CLI help and routing expose `onboard` but no root `setup` command.
- Root workspace scripts use `onboard` as the public entrypoint instead of `setup`.
- Docs and tests no longer instruct users to use the removed root `setup` command.
- Required verification passes for the touched CLI/docs surface.

## Scope

- In scope:
  - Root onboarding command registration and routing in `packages/cli`
  - Root workspace script aliases in `package.json`
  - Root onboarding docs and CLI tests that mention `setup` as a public entrypoint
- Out of scope:
  - Internal implementation filenames and helper names still using `setup`
  - `inbox setup` and other non-root command surfaces where `setup` remains the correct verb
  - Host bootstrap shell wrappers such as `scripts/setup-host.sh`

## Constraints

- Technical constraints:
  - Keep `inbox setup` and other runtime-control `setup` semantics intact.
  - Preserve the existing onboarding behavior; this is a naming/routing cleanup, not a workflow redesign.
- Product/process constraints:
  - Preserve unrelated worktree edits.
  - Run required verification and the required final audit before handoff.

## Risks and mitigations

1. Risk: Removing the root command could break `murph` alias routing or help output assumptions.
   Mitigation: Update the CLI router plus focused tests that cover invocation detection, help text, and post-setup handoff.
2. Risk: Over-broad search/replace could remove valid `setup` usage from inbox/runtime surfaces.
   Mitigation: Limit edits to the root onboarding surface and leave subsystem-specific `setup` verbs unchanged.

## Tasks

1. Register the coordination ledger row and confirm the touched public surfaces.
2. Remove the root `setup` command/script exposure while keeping `onboard` behavior unchanged.
3. Update focused tests and docs to match the new single-entrypoint surface.
4. Run required verification plus a direct built-CLI/help scenario.
5. Run the required completion audit, fix anything found, then finish and commit the scoped change.

## Decisions

- Keep internal module/file names such as `setup-cli.ts` and `setup-services.ts` for this pass; only the public command surface changes.
- Leave `setup:host`, `setup:macos`, `setup:linux`, and `setup:inbox` intact because the collision only affects the root `pnpm setup` surface.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
  - Focused built-CLI/help checks if needed while iterating
- Expected outcomes:
  - Green repo-required verification for the CLI/docs change, or clearly documented unrelated blockers if any exist.
- Outcomes:
  - `pnpm typecheck`: passed.
  - `pnpm exec vitest run --config vitest.config.ts --project cli-inbox-setup --no-coverage packages/cli/test/setup-cli.test.ts`: passed after updating the onboarding help assertion.
  - `node packages/cli/dist/bin.js --help` and `node packages/cli/dist/bin.js onboard --help`: passed and showed no root `setup` command.
  - `pnpm test`: failed for an unrelated pre-existing assertion in `packages/cli/test/release-script-coverage-audit.test.ts` caused by the separate local-web rename work already in the dirty tree.
  - `pnpm test:coverage`: failed for that same unrelated release-manifest assertion plus a separate pre-existing `packages/cli/test/health-tail.test.ts` ENOENT under the current dirty tree.
Completed: 2026-03-31
