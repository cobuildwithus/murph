# Group Join Offer Template

## Goal

Make hosted group join offers model-authored instead of fixed canned copy, while
keeping the join URL, share-scope facts, Linq thread authority, send effect, and
provider-message binding server-owned.

Success criteria:

- `post_join_offer` requires a short natural message template from Murph.
- The template must contain server-filled `{{join_url}}` and `{{share_scope}}`
  placeholders before any join offer is sent.
- The sent message no longer uses the deterministic "Like this message" script.
- Focused parser, assistant-tool, runtime-context, and hosted-web tests prove the
  contract.

## Constraints

- Preserve the existing group join offer semantics and provider-message binding.
- Do not introduce a message bank or new persisted state.
- Keep the implementation narrow and composable.
- Do not expose local identifiers, secrets, raw provider payloads, or private
  user data in code, docs, logs, or handoff.

## Plan

1. Extend the hosted group `post_join_offer` request with a model-authored
   `messageTemplate`.
2. Validate required placeholders server-side before creating or sending the
   join offer.
3. Update assistant tool guidance and schema so Murph writes natural copy with
   placeholders instead of a fixed script.
4. Update focused tests across hosted execution parsing, assistant tool
   conversion, runtime Linq context injection, and hosted-web send behavior.
5. Run focused verification plus typecheck, review the diff, and commit only
   this task's files.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-group-tool.test.ts` passed.
- `pnpm exec vitest run packages/hosted-execution/test/parsers.test.ts packages/assistant-engine/test/assistant-codex-group-tool.test.ts packages/assistant-runtime/test/hosted-runtime-group-tool-linq-context.test.ts` passed.
- `pnpm --dir packages/hosted-execution test` passed.
- `pnpm --dir packages/assistant-engine test` passed.
- `pnpm --dir packages/assistant-runtime test` passed.
- `pnpm --dir apps/web test -- --help` unexpectedly ran the app Vitest workspace and passed.
- `pnpm typecheck` passed.
- `pnpm --dir apps/web lint` passed with existing warnings only.
- `pnpm test:diff ...` ran affected typechecks and several package suites, then stopped on the unrelated `packages/cli/test/cli-expansion-intervention.test.ts` test `intervention edit/delete mutate and remove the saved intervention_session event`; rerunning that exact test fails the same way and the current diff does not touch CLI intervention code.

## State

Implementation complete. Ready to close and commit.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
