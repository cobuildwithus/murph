# Web default vault fallback

Status: completed
Created: 2026-03-23
Updated: 2026-03-23

## Goal

- Let the local web app open the saved Healthy Bob CLI default vault when `HEALTHYBOB_VAULT` is unset, while keeping explicit env selection as the highest-precedence input.

## Success criteria

- `packages/web` resolves `HEALTHYBOB_VAULT` first when it is set.
- When `HEALTHYBOB_VAULT` is unset, the web server falls back to the saved operator config default vault if one exists.
- Invalid or missing operator config still yields the existing safe `missing-config` state.
- The setup-state copy and package/runtime docs reflect the new fallback behavior.
- Focused web tests pass, and the required repo checks are attempted with outcomes recorded truthfully.

## Scope

- In scope:
- `packages/web/src/lib/{vault,overview}.ts`
- `packages/web/app/page.tsx`
- `packages/web/test/{overview,page,route}.test.ts`
- `packages/web/README.md`
- `ARCHITECTURE.md`
- `agent-docs/index.md`
- `agent-docs/operations/verification-and-runtime.md`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- changes to CLI operator-config write semantics
- new vault-selection UI beyond the current setup-state guidance
- unrelated assistant/CLI/runtime failures already present in the worktree

## Constraints

- Preserve explicit `HEALTHYBOB_VAULT` precedence.
- Keep the change local to web-side vault resolution and nearby docs/tests.
- Do not expose raw operator-home paths or vault paths in user-visible error copy.

## Risks and mitigations

1. Risk: the web app could diverge from the CLI’s saved-default expansion semantics.
   Mitigation: mirror the CLI behavior for `~` and `~/...` expansion and add focused tests around fallback and precedence.
2. Risk: the setup screen could become misleading once a saved default is supported.
   Mitigation: update the copy/docs so missing-config means both env and saved default are unavailable.
3. Risk: repo-wide checks could remain red because of unrelated existing failures.
   Mitigation: run focused web verification first, then attempt the required repo checks and record any unrelated blockers separately.

## Tasks

1. Add async web vault resolution that prefers `HEALTHYBOB_VAULT` and otherwise reads the saved default vault from operator config.
2. Update overview loading to use the async resolver.
3. Adjust setup-state copy and package/runtime docs for the new fallback behavior.
4. Add focused tests for saved-default fallback, env precedence, and invalid config handling.
5. Run focused web verification plus the required repo checks, then commit only scoped files if unrelated repo failures remain.

## Decisions

- The fallback stays web-local for now instead of adding a new web dependency on the CLI package.
- Invalid or unreadable operator config is treated the same as no saved default.
- The setup-state suggested command remains the explicit env-based recovery command, because it is deterministic and does not require prior CLI setup.

## Verification

- Commands to run:
- `pnpm exec vitest run --config packages/web/vitest.config.ts packages/web/test/overview.test.ts packages/web/test/page.test.ts packages/web/test/route.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/web typecheck`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused web checks pass
- repo-wide checks may still surface unrelated pre-existing CLI/assistant failures outside the touched web/docs files
Completed: 2026-03-23
