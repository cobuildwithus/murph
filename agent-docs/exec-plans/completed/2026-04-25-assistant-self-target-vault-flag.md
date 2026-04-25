# Fix assistant self-target vault flag compatibility

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Fix hosted/bound assistant runtime command wrapping so `assistant self-target`
  inspection commands do not fail with `Unknown flag: --vault` when invoked
  through the assistant tool surface.

## Success criteria

- Root cause is identified at the wrapper/parser boundary.
- `assistant self-target show/list` can be invoked through the bound runtime
  command path without an unsupported `--vault` flag.
- Regression coverage proves the compatibility behavior.
- Required focused verification and completion audits run or blockers are
  documented.

## Scope

- In scope: assistant CLI/bound runtime flag compatibility and direct tests.
- Out of scope: changing persisted self-target config semantics, channel
  delivery behavior, or hosted control-plane routing.

## Constraints

- Technical constraints: preserve explicit vault scoping for command families
  that require it; do not weaken command authority or broaden runtime tools.
- Product/process constraints: preserve unrelated dirty work and active hosted
  lanes; avoid logging or fixture data that contains personal identifiers.

## Risks and mitigations

1. Risk: skipping `--vault` too broadly could run vault-scoped commands outside
   their intended bound vault.
   Mitigation: scope any exception to the exact unsupported self-target
   command family or add parser support only where semantics are already
   global/local.
2. Risk: touching shared assistant-runtime files could overlap active hosted
   rows.
   Mitigation: inspect ownership first and prefer the narrowest CLI/tool wrapper
   seam with focused tests.

## Tasks

1. Trace `--vault` injection from hosted/bound runtime to CLI command parsing.
2. Reproduce the failure with a focused command or test.
3. Patch the smallest compatibility seam and add regression coverage.
4. Run focused verification, required audits, and direct scenario proof.
5. Close the plan and commit scoped changes if safe.

## Decisions

- Root cause: hosted/bound runtime prepends `--no-config` before invoking
  `vault-cli`; the default-vault classifier recognized value-style root
  options but not root boolean flags when deriving the command path, so it did
  not see the existing `assistant self-target` vault exemption.
- Fix the shared classifier rather than making `assistant self-target` accept a
  no-op `--vault` option.
- Keep the compatibility fix centralized in the command-path/default-vault
  classifier. While reviewing that seam, also treat root `--config` as a
  value-taking root option and include the vault-backed `query` command family
  in the same vault classification table.

## Verification

- Commands to run: focused affected tests, `pnpm typecheck`, and a truthful
  `pnpm test:diff` or owner coverage lane for the touched files.
- Expected outcomes: compatibility regression passes; typecheck and required
  focused checks are green, or unrelated blockers are named.
- Direct proof:
  - `pnpm exec tsx -e "..."` for
    `['--no-config','assistant','self-target','list','--format','json']`
    returned `needs:false` and did not inject `--vault`.
  - After rebuilding `packages/operator-config/dist`, `HOME=<tmp> VAULT=<tmp>
    pnpm exec tsx packages/cli/src/bin.ts --no-config assistant self-target
    list --format json` returned JSON with `targets.length === 0` instead of
    `Unknown flag: --vault`.
- Completed:
  - `pnpm --dir packages/operator-config test -- operator-config-seam`
  - `pnpm --dir packages/assistant-cli test -- assistant-command-coverage`
  - `pnpm --dir packages/operator-config typecheck`
  - `pnpm --dir packages/operator-config test:coverage`
  - `pnpm --dir packages/operator-config test -- operator-config-seam` after
    security-review follow-ups
  - `pnpm --dir packages/operator-config typecheck` after security-review
    follow-ups
  - `bash scripts/workspace-verify.sh test:diff packages/operator-config/src/command-helpers.ts packages/operator-config/src/operator-config/cli-vault-defaults.ts packages/operator-config/test/operator-config-seam.test.ts`
  - `pnpm typecheck`
  - `pnpm --dir packages/operator-config build`
  - `pnpm typecheck` after final coverage-review assertion
  - `pnpm --dir packages/operator-config test:coverage` after final
    coverage-review assertion
  - `git diff --check -- packages/operator-config/src/command-helpers.ts packages/operator-config/src/operator-config/cli-vault-defaults.ts packages/operator-config/test/operator-config-seam.test.ts agent-docs/exec-plans/active/2026-04-25-assistant-self-target-vault-flag.md`
  - `rg -n "[ \t]$" agent-docs/exec-plans/active/2026-04-25-assistant-self-target-vault-flag.md`
    returned no matches for the untracked plan file.
- Earlier blocked, then resolved on final rerun:
  - Initial `pnpm typecheck` and initial `test:diff` reached unrelated Health
    Commons generation errors. After the active tree moved forward, final
    reruns passed.
Completed: 2026-04-25
