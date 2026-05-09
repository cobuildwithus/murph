# Intervention experiment auto-linking

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Make `vault-cli intervention add` automatically link a captured intervention session to one unambiguous active matching experiment, while preserving a simple explicit repair path for existing or mislinked sessions.

## Success criteria

- `intervention add` links to exactly one active in-window matching experiment by default.
- `intervention add --experiment <slug>` links the requested experiment, and `--skip-experiment-link` opts out.
- Ambiguous automatic matches fail before writing.
- Repair commands can attach, replace, and detach experiment links without deleting/recreating the event or dropping non-experiment links.
- Tests and docs cover the command surface and link invariants.

## Scope

- In scope:
- `packages/vault-usecases` intervention/experiment session link resolution and event revision helpers.
- `packages/cli` intervention add flags plus experiment session attach/detach commands.
- Focused CLI tests, durable contract/product docs, and generated CLI command metadata.
- Out of scope:
- Generic raw event patch/link flags.
- Automatic historical backfill.
- Query/adherence model redesign.

## Constraints

- Technical constraints:
- Keep `packages/core` as the canonical writer and `packages/query` read-only.
- Keep link state as one invariant: `experimentId`, `experimentSlug`, and one `related_to` link to the experiment id must move together.
- Preserve non-experiment links such as regimen links during link, unlink, and regimen edits.
- Product/process constraints:
- Do not silently choose between multiple matching experiments.
- Do not expose legal names, local usernames, home paths, or secrets in docs/tests/output.

## Risks and mitigations

1. Risk: Wrong or stale experiment links make sessions count in the wrong run.
   Mitigation: Auto-link only active, matching, in-window, single-candidate experiments; require explicit replace for relinks.
2. Risk: Repair commands accidentally remove regimen links.
   Mitigation: Centralize experiment-link patching and filter only experiment links.

## Tasks

1. Done: Add link resolution and event-link mutation helpers in vault usecases.
2. Done: Expose CLI flags/commands with conservative ambiguity behavior.
3. Done: Add focused tests for auto-link, opt-out/explicit, ambiguity, attach/replace/detach, and link preservation.
4. Done: Update durable docs and command contracts.
5. Done: Run verification and prepare the scoped finish-task commit.

## Decisions

- Automatic linking belongs in `packages/vault-usecases`, not CLI, core, or query.
- Repair surface is `experiment session attach/detach`; no generic event patch knobs.
- The opt-out flag is `--skip-experiment-link`; `--no-experiment` conflicts with the parser semantics for `--experiment <slug>`.
- Add an exact `@murphai/vault-usecases/records` TS path mapping so local package typecheck resolves source instead of stale built declarations.

## Verification

- Passed:
- `pnpm --dir packages/vault-usecases typecheck`
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/operator-config typecheck`
- `pnpm typecheck`
- `pnpm test:diff packages/vault-usecases/src/usecases/intervention.ts packages/vault-usecases/src/usecases/experiment-journal-vault.ts packages/vault-usecases/src/usecases/intervention-experiment-link.ts packages/cli/src/commands/intervention.ts packages/cli/src/commands/experiment.ts packages/cli/test/cli-expansion-intervention.test.ts packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts packages/operator-config/src/vault-cli-contracts.ts tsconfig.base.json`
- `git diff --check`
Completed: 2026-05-09
