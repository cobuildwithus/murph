# Fix hosted-local runner bundle to include Murph CLI shims

Status: completed
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- `pnpm dev` / hosted-local runner bundles expose the same Murph CLI shims that the assistant prompt tells Codex to use, especially `vault-cli` and `murph`.

## Success criteria

- Reproduce the current hosted-local bundle missing `vault-cli` / `murph`.
- Patch hosted-local bundle preparation to include the Murph CLI package.
- Prove the assembled bundle exposes `vault-cli`, `murph`, and `murph-device-syncd`.
- Run focused tests plus typecheck according to repo verification policy.

## Scope

- In scope: local hosted runner bundle assembly scripts/tests, hosted-local harness setup command, runner bundle contract tests.
- Out of scope: generic hosted CLI bridge expansion, production deploy changes beyond sharing the existing production bundle shape.

## Constraints

- Technical constraints: keep hosted runner child env minimal; do not reintroduce deprecated Codex bridge env; preserve production bundle path.
- Product/process constraints: redact local paths and identifiers in handoff; do not touch unrelated active `apps/web` work.

## Risks and mitigations

1. Risk: hosted-local startup gets slower because the CLI-capable closure is larger.
   Mitigation: keep existing build concurrency override and skip pack preflights in dev setup.
2. Risk: tests still encode the old reduced hosted-local bundle.
   Mitigation: update tests to assert CLI shim availability is required for hosted-local.

## Tasks

1. Reproduce missing CLI shims from current hosted-local bundle.
2. Patch `runner:bundle:hosted-local` and callers/tests.
3. Assemble a fixed bundle and verify CLI shim paths.
4. Run focused verification and required audits.
5. Commit scoped fix.

## Decisions

- Hosted-local should use the same CLI-capable runner closure as production because assistant prompts and Codex shell access are shared.

## Verification

- Commands to run: focused Vitest for runner bundle/dev stack/harness coverage, `pnpm typecheck`, and a direct assembled-bundle shim check.
- Expected outcomes: all required checks pass; direct `command -v` finds `vault-cli`, `murph`, and `murph-device-syncd` under the runner bundle `.bin`.
- Current failure reproduced from existing hosted-local artifact: `.bin` had `murph-device-syncd` but not `vault-cli` or `murph`.
- Fixed bundle assembled with `MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY=1 MURPH_RUNNER_BUNDLE_SKIP_PACK_PREFLIGHTS=1 pnpm --dir apps/cloudflare runner:bundle:hosted-local`; `.bin` now exposes all three shims.
Completed: 2026-05-03
