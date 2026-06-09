# Simplify Codex app-server reuse repair

Status: completed
Created: 2026-06-09
Updated: 2026-06-09

## Goal

- Reevaluate the Codex app-server reuse repair with a deletion-first lens and
  remove machinery that is not needed for the actual Murph provider path.

## Success criteria

- Low-level Codex runner stays thin: no Murph-owned provider-table digesting or
  config-file default projection in process reuse identity.
- Real stale-reuse safeguards remain: current execution context is sent on
  `thread/resume`, stale resume responses stop that reuse path before
  `turn/start`, and the product provider retries the same user turn on a fresh
  thread instead of failing to reply.
- Interrupt/abort cleanup cannot leave the warm slot permanently busy.
- Focused assistant-engine tests and typecheck pass, or unrelated failures are
  named exactly.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant-codex.ts`
  - `packages/assistant-engine/src/assistant-codex/app-server-requests.ts`
  - `packages/assistant-engine/src/assistant-codex/config.ts`
  - `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
  - `packages/cli/test/assistant-codex.test.ts`
  - Codex app-server reuse docs touched by the prior repair commit.
- Out of scope:
  - Hosted runner lanes, supplement backfill work, exercise catalog work.
  - Changing the upstream Codex app-server protocol.

## Constraints

- Technical constraints:
  - Preserve the shared single warm app-server slot and busy semantics.
  - Preserve normal Murph provider path behavior where model/provider and
    provider-table overrides are explicit request or `--config` inputs.
  - Stale native resume is an optimization miss, not a user-visible no-reply
    condition.
- Product/process constraints:
  - Default to deletion and avoid new abstractions.
  - Preserve unrelated dirty work and active lanes.

## Risks and mitigations

1. Risk: deleting too much reopens stale resume behavior or turns stale resume
   into a no-reply failure.
   Mitigation: keep resume context request/response regression coverage and
   provider-level stale-resume-to-fresh-thread coverage.
2. Risk: low-level direct callers relying on implicit Codex config defaults may
   expect Murph to track config file changes.
   Mitigation: keep the runner thin and document that explicit Murph inputs or
   process identity inputs drive reuse; Codex owns its config file.

## Tasks

1. Identify machinery added only for config-file provider/default tracking.
2. Delete unnecessary source code and stale tests/docs.
3. Run focused assistant-engine checks.
4. Run required completion review/audits and commit.

## Decisions

- Keep the resume-context request and response guard. Upstream Codex can rejoin a
  loaded thread and ignore overrides; Murph must not start a turn on stale
  policy/model/cwd/sandbox.
- A stale resume guard trips the resume optimization only. The provider wrapper
  must recover by starting a fresh thread for the same user turn; a prepared
  fallback plan gives the fresh thread full bootstrap context, but missing
  fallback should still get a best-effort fresh reply rather than no reply.
- Remove Murph-side provider-table config-file hashing/default projection from
  the low-level runner. The normal Murph path passes model/provider through RPC
  and provider-table overrides through process args.

## Verification

- Passed:
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-codex-runtime.test.ts test/codex-thread-instructions.test.ts --no-coverage`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/assistant-engine test:coverage`
  - `pnpm --dir packages/assistant-cli typecheck`
  - `pnpm --dir packages/assistant-cli exec vitest run --config vitest.config.ts test/assistant-ui-ink.test.ts test/assistant-ui-controller.test.ts test/assistant-ui-runtime.test.ts --no-coverage`
  - `pnpm --dir packages/cli typecheck`
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/assistant-codex.test.ts --no-coverage`
  - `pnpm docs:drift`
  - `git diff --check -- <scoped task files>`
- Blocked by unrelated active work:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff <scoped task files>`
  - Both stop on pre-existing supplement test type errors in
    `scripts/supplement-db-brand-site-labels.test.ts` where
    `preview.productionCandidate.label.ingredientRows` is possibly undefined
    and callback row types do not match `Record<string, unknown>`.
Completed: 2026-06-09
